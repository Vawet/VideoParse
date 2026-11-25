"""Run against an isolated MySQL/Spring instance with graph publication disabled."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from threading import Barrier
import time
import uuid

import requests
from sqlalchemy import create_engine, text


def visitor(base):
    with requests.Session() as session:
        response = session.get(base + "/v2/session", timeout=5)
        response.raise_for_status()
        return response.json()["workspace_id"], session.cookies.get_dict()


def run(base, database_url, task_count=1):
    base = base.rstrip("/")
    readers = max(64, task_count)
    gate = Barrier(readers + 1, timeout=30)
    owners = [visitor(base), visitor(base)]
    tasks = [uuid.uuid4().hex for _ in range(task_count)]
    videos = [uuid.uuid4().hex for _ in tasks]
    engine = create_engine(database_url)
    insert = text("INSERT INTO vp_event(job_id,payload) VALUES (:task,:payload)")

    def emit(conn, task, payload):
        return conn.execute(insert, {"task": task, "payload": json.dumps(payload)}).lastrowid

    ids = []
    with engine.begin() as conn:
        for i, (task, video) in enumerate(zip(tasks, videos)):
            conn.execute(text("""INSERT INTO videos(id,title,duration,status,created_at,owner_id)
                VALUES (:video,'SSE fixture',0,'pending',NOW(),:owner)"""), {"video": video, "owner": owners[i % 2][0]})
            conn.execute(text("""INSERT INTO vp_job(id,video_id,active_video,status)
                VALUES (:task,:video,:video,'publishing')"""), {"task": task, "video": video})
            ids.append([emit(conn, task, {"type": "progress", "n": 0})])

    def read(i, after, live=False):
        seen, types = [], []
        with requests.get(base + "/tasks/" + tasks[i] + "/events", headers={"Last-Event-ID": str(after)},
                          cookies=owners[i % 2][1], stream=True, timeout=(5, 25)) as response:
            response.raise_for_status()
            assert response.headers["Content-Type"].startswith("text/event-stream")
            for line in response.iter_lines(chunk_size=32):
                if line.startswith(b"id: "):
                    event_id = int(line[4:])
                elif line.startswith(b"data: "):
                    seen.append(event_id)
                    types.append(json.loads(line[6:])["type"])
                    if live and len(seen) == 1:
                        gate.wait()
        return seen, types

    try:
        status_url = base + "/tasks/" + tasks[0]
        assert requests.get(status_url, cookies=owners[1][1], timeout=5).status_code == 404
        assert requests.get(status_url + "/events", cookies=owners[1][1], timeout=5).status_code == 404
        snapshot = requests.get(status_url, cookies=owners[0][1], timeout=5).json()
        assert snapshot == {"success": True, "video_id": videos[0], "status": "publishing", "error": None, "events": 1}
        with ThreadPoolExecutor(readers) as pool:
            streams = [pool.submit(read, n % task_count, 0, True) for n in range(readers)]
            gate.wait()
            time.sleep(0.6)
            with engine.connect() as conn:
                def selects():
                    return int(conn.exec_driver_sql("SHOW GLOBAL STATUS LIKE 'Com_select'").one()[1])
                before = selects()
                time.sleep(5)
                idle = selects() - before
            # One task crosses three event pages; the others end in the same transaction.
            with engine.begin() as conn:
                ids[0].extend(emit(conn, tasks[0], {"type": "progress", "n": n}) for n in range(1, 221))
                for i, task in enumerate(tasks):
                    conn.execute(text("UPDATE vp_job SET status='done',active_video=NULL WHERE id=:id"), {"id": task})
                    ids[i].append(emit(conn, task, {"type": "end", "status": "done"}))
            for n, stream in enumerate(streams):
                expected = ids[n % task_count]
                assert stream.result() == (expected, ["progress"] * (len(expected) - 1) + ["end"])
        snapshot = requests.get(status_url, cookies=owners[0][1], timeout=5).json()
        assert snapshot["status"] == "done" and snapshot["events"] == len(ids[0])
        for cursor in (0, ids[0][88], ids[0][201], ids[0][-1], ids[0][-1] + 720):
            assert read(0, cursor)[0] == [event for event in ids[0] if event > cursor]
        print(f"{readers} connections, {task_count} tasks, {idle} SELECTs during 5 idle seconds, ordered replay OK")
        assert idle < readers, "Idle reads should be shared across subscribers and tasks"
    finally:
        with engine.begin() as conn:
            for table, key, values in [("vp_event", "job_id", tasks), ("vp_job", "id", tasks), ("videos", "id", videos)]:
                conn.execute(text(f"DELETE FROM {table} WHERE {key}=:id"), [{"id": value} for value in values])
            conn.execute(text("DELETE FROM vp_visitor WHERE id IN (:a,:b)"), {"a": owners[0][0], "b": owners[1][0]})
        engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("api_base")
    parser.add_argument("--tasks", type=int, default=1, help="同时被订阅的独立任务数")
    args = parser.parse_args()
    if not 1 <= args.tasks <= 256:
        parser.error("--tasks must be between 1 and 256")
    run(args.api_base, os.environ["FANOUT_TEST_DATABASE_URL"], args.tasks)

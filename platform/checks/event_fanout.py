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


def run(base, database_url):
    readers = 64
    gate = Barrier(readers + 1, timeout=30)
    task, video = uuid.uuid4().hex, uuid.uuid4().hex
    endpoint = base.rstrip("/") + "/tasks/" + task + "/events"
    engine = create_engine(database_url)
    with requests.Session() as owner, requests.Session() as other, engine.begin() as conn:
        def visitor(session):
            response = session.get(base.rstrip("/") + "/v2/session", timeout=5)
            response.raise_for_status()
            return response.json()["workspace_id"]

        owner_id, other_id = visitor(owner), visitor(other)
        cookies = owner.cookies.get_dict()
        foreign = other.cookies.get_dict()
        conn.execute(text("""INSERT INTO videos(id,title,duration,status,created_at,owner_id)
            VALUES (:video,'SSE fixture',0,'pending',NOW(),:owner)"""), {"video": video, "owner": owner_id})
        conn.execute(text("""INSERT INTO vp_job(id,video_id,active_video,status)
            VALUES (:task,:video,:video,'publishing')"""), {"task": task, "video": video})
        insert = text("INSERT INTO vp_event(job_id,payload) VALUES (:task,:payload)")
        def emit(conn, payload):
            return conn.execute(insert, {"task": task, "payload": json.dumps(payload)}).lastrowid
        first = emit(conn, {"type": "progress", "n": 0})

    def read(after, live=False):
        ids, types = [], []
        with requests.get(endpoint, headers={"Last-Event-ID": str(after)}, cookies=cookies,
                          stream=True, timeout=(5, 20)) as response:
            response.raise_for_status()
            assert response.headers["Content-Type"].startswith("text/event-stream")
            for line in response.iter_lines(chunk_size=32):
                if line.startswith(b"id: "):
                    event_id = int(line[4:])
                elif line.startswith(b"data: "):
                    ids.append(event_id)
                    types.append(json.loads(line[6:])["type"])
                    if live and len(ids) == 1:
                        gate.wait()
        return ids, types

    try:
        assert requests.get(endpoint, cookies=foreign, timeout=5).status_code == 404
        with ThreadPoolExecutor(readers) as pool:
            streams = [pool.submit(read, 0, True) for _ in range(readers)]
            gate.wait()
            time.sleep(0.6)
            with engine.connect() as conn:
                def selects():
                    return int(conn.exec_driver_sql("SHOW GLOBAL STATUS LIKE 'Com_select'").one()[1])
                before = selects()
                time.sleep(5)
                idle = selects() - before
            # Publish a burst spanning three replay pages, including the atomic terminal event.
            with engine.begin() as conn:
                ids = [first] + [emit(conn, {"type": "progress", "n": i}) for i in range(1, 221)]
                conn.execute(text("UPDATE vp_job SET status='done',active_video=NULL WHERE id=:id"), {"id": task})
                ids.append(emit(conn, {"type": "end", "status": "done"}))
            for stream in streams:
                assert stream.result() == (ids, ["progress"] * 221 + ["end"])
        for cursor in (0, ids[88], ids[201], ids[-1], ids[-1] + 720):
            assert read(cursor)[0] == [event for event in ids if event > cursor]
        print(f"{readers} connections, {idle} SELECTs during 5 idle seconds, {len(ids)} ordered events per reader")
        assert idle < readers, "Idle reads should be shared across subscribers"
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM vp_event WHERE job_id=:id"), {"id": task})
            conn.execute(text("DELETE FROM vp_job WHERE id=:id"), {"id": task})
            conn.execute(text("DELETE FROM videos WHERE id=:id"), {"id": video})
            conn.execute(text("DELETE FROM vp_visitor WHERE id IN (:a,:b)"), {"a": owner_id, "b": other_id})
        engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("api_base")
    run(parser.parse_args().api_base, os.environ["FANOUT_TEST_DATABASE_URL"])

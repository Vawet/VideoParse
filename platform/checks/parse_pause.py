"""Exercise task ownership and durable pause transitions on a disposable Spring/MySQL instance."""
import os
import sys
import time
import uuid

import requests
from sqlalchemy import create_engine, text
from test_account import register


def run(base, database):
    engine = create_engine(database)
    job = uuid.uuid4().hex
    task = f"{base}/tasks/{job}"
    try:
        with requests.Session() as owner, requests.Session() as stranger, engine.connect() as guard:
            register(owner, base)
            register(stranger, base)
            visitor = owner.get(base + "/v2/session", timeout=5).json()["workspace_id"]
            lock = {"name": "videoparse:" + job}
            assert guard.execute(text("SELECT GET_LOCK(:name,0)"), lock).scalar_one() == 1
            with engine.begin() as db:
                db.execute(text("""INSERT INTO videos(id,title,duration,status,created_at,owner_id)
                    VALUES(:id,'Pause check',0,'uploaded',NOW(),:owner)"""), {"id": job, "owner": visitor})
                db.execute(text("""INSERT INTO vp_job(id,video_id,active_video,status)
                    VALUES(:id,:id,:id,'queued')"""), {"id": job})
            try:
                assert stranger.post(task + "/pause", timeout=5).status_code == 404
                for _ in range(2):
                    assert owner.post(task + "/pause", timeout=5).json()["status"] == "paused"
                assert owner.post(task + "/resume", timeout=5).json()["status"] == "queued"

                # Represent a worker holding the execution lock during a tool.
                with engine.begin() as db:
                    db.execute(text("UPDATE vp_job SET status='running' WHERE id=:id"), {"id": job})
                assert owner.post(task + "/pause", timeout=5).json()["status"] == "pausing"
                assert owner.post(task + "/resume", timeout=5).status_code == 409
                # Worker loss at this point must be recoverable without starting another tool.
                assert guard.execute(text("SELECT RELEASE_LOCK(:name)"), lock).scalar_one() == 1
                deadline = time.monotonic() + 10
                while owner.get(task, timeout=5).json()["status"] != "paused":
                    assert time.monotonic() < deadline, "orphaned pause was never acknowledged"
                    time.sleep(.1)
                with engine.connect() as db:
                    events = db.execute(text("SELECT payload->>'$.status' FROM vp_event WHERE job_id=:id ORDER BY id"),
                                        {"id": job}).scalars().all()
                    assert events == ["paused", "queued", "pausing", "paused"], events
            finally:
                with engine.begin() as db:
                    db.execute(text("DELETE FROM vp_dispatch WHERE job_id=:id"), {"id": job})
                    db.execute(text("DELETE FROM vp_event WHERE job_id=:id"), {"id": job})
                    db.execute(text("DELETE FROM vp_job WHERE id=:id"), {"id": job})
                    db.execute(text("DELETE FROM videos WHERE id=:id"), {"id": job})
    finally:
        engine.dispose()


if __name__ == "__main__":
    run(sys.argv[1].rstrip("/"), os.environ["JOB_POLL_TEST_DATABASE_URL"])
    print("PASS queue pause, ownership, idempotency and interrupted-worker recovery")

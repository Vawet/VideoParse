"""Check SQL recovery on a disposable instance with MQ off, graph publishing on and no media worker."""
import os
import sys
import time
import uuid

import requests

from test_account import register
from sqlalchemy import create_engine, text


def run(base, database):
    engine = create_engine(database)
    try:
        with requests.Session() as session, engine.connect() as holder:
            register(session, base)
            visitor = session.get(base + "/v2/session", timeout=5)
            visitor.raise_for_status()
            owner = visitor.json()["workspace_id"]
            blocked = [{"id": uuid.uuid4().hex, "stage": stage}
                       for stage in ("running", "publishing") for _ in range(128)]
            targets = {stage: uuid.uuid4().hex for stage in ("queued", "running", "publishing")}
            for row in blocked:
                assert holder.execute(text("SELECT GET_LOCK(CONCAT('videoparse:',:id),0)"), row).scalar_one() == 1
            try:
                with engine.begin() as db:
                    db.execute(text("""
                        INSERT INTO vp_job(id,video_id,active_video,status,created_at,publish_after)
                        VALUES (:id,:id,:id,:stage,'2000-01-01','2000-01-01')
                        """), blocked)
                    for stage, job in targets.items():
                        db.execute(text("""
                            INSERT INTO videos(id,title,duration,status,created_at,owner_id)
                            VALUES (:id,'Queue fixture',1,'uploaded',NOW(),:owner)
                            """), {"id": job, "owner": owner})
                        db.execute(text("""
                            INSERT INTO vp_job(id,video_id,active_video,status,publish_attempts)
                            VALUES (:id,:id,:id,:stage,4)
                            """), {"id": job, "stage": stage})
                deadline = time.monotonic() + 10
                while True:
                    states = {}
                    for stage, job in targets.items():
                        response = session.get(base + "/tasks/" + job, timeout=3)
                        response.raise_for_status()
                        states[stage] = response.json()["status"]
                    # The runnable fixtures have neither a media worker nor a graph snapshot.
                    if all(state == "error" for state in states.values()):
                        break
                    assert time.monotonic() < deadline, states
                    time.sleep(0.1)
                with engine.connect() as db:
                    for stage, job in targets.items():
                        count = db.execute(text("""
                            SELECT COUNT(*) FROM vp_event WHERE job_id=:job AND payload->>'$.type'='end'
                            """), {"job": job}).scalar_one()
                        assert count == 1, (stage, count)
            finally:
                # Remove the synthetic busy jobs before releasing their execution locks.
                with engine.begin() as db:
                    db.execute(text("DELETE FROM vp_job WHERE id=:id"), blocked)
                holder.execute(text("SELECT RELEASE_ALL_LOCKS()"))
    finally:
        engine.dispose()
    print("PASS both SQL pollers reached the free job behind 128 active locks")


if __name__ == "__main__":
    run(sys.argv[1].rstrip("/"), os.environ["JOB_POLL_TEST_DATABASE_URL"])

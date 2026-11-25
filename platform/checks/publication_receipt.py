"""Recover a committed Neo4j snapshot on a disposable platform with no media files."""
import os
import sys
import time
import uuid

import requests
from sqlalchemy import create_engine, text


def run(base, neo4j, database):
    session = requests.Session()
    response = session.get(base + "/v2/session", timeout=5)
    response.raise_for_status()
    owner = response.json()["workspace_id"]
    engine = create_engine(database)
    try:
        for matches in (True, False):
            video, job = uuid.uuid4().hex, uuid.uuid4().hex
            # Reproduce a graph commit whose MySQL version switch has not happened.
            statement = """
                CREATE (:VPVideo {id:$video})-[:HAS_ANALYSIS]->(a:VPAnalysis {id:$job,result:$result})
                CREATE (a)-[:HAS_EVIDENCE]->(:VPEvidence {id:0,source:'speech',start:2.0,end:5.0,
                    text:'queue recovery',frame:''})
                """
            params = {"video": video if matches else uuid.uuid4().hex, "job": job, "result": '{"title":"recovered"}'}
            reply = requests.post(neo4j + "/db/neo4j/tx/commit",
                                  auth=(os.getenv("NEO4J_USER", "neo4j"), os.getenv("NEO4J_PASSWORD", "")),
                                  json={"statements": [{"statement": statement, "parameters": params}]}, timeout=15)
            reply.raise_for_status()
            assert reply.json()["errors"] == []
            with engine.begin() as db:
                db.execute(text("""
                    INSERT INTO videos(id,title,duration,status,created_at,owner_id)
                    VALUES (:video,'Receipt',5,'analyzed',NOW(),:owner)
                    """), {"video": video, "owner": owner})
                db.execute(text("""
                    INSERT INTO vp_job(id,video_id,active_video,status,publish_attempts)
                    VALUES (:job,:video,:video,'publishing',4)
                    """), {"job": job, "video": video})
            deadline = time.monotonic() + 15
            while True:
                response = session.get(base + "/tasks/" + job, timeout=5)
                response.raise_for_status()
                status = response.json()["status"]
                if status != "publishing":
                    break
                assert time.monotonic() < deadline, status
                time.sleep(0.1)
            assert status == ("done" if matches else "error"), status
            with engine.connect() as db:
                head = db.execute(text("SELECT job_id FROM vp_graph_head WHERE video_id=:v"), {"v": video}).scalar()
                assert head == (job if matches else None)
            if matches:
                assert session.get(base + "/result/" + video, timeout=5).json()["result"]["title"] == "recovered"
                hits = session.get(base + "/v2/videos/" + video + "/evidence", params={"q": "queue"}, timeout=5)
                assert hits.json()["hits"][0]["text"] == "queue recovery"
    finally:
        engine.dispose()
        session.close()
    print("PASS committed snapshot recovered without workspace; different video's snapshot rejected")


if __name__ == "__main__":
    run(sys.argv[1].rstrip("/"), sys.argv[2].rstrip("/"), os.environ["PUBLICATION_TEST_DATABASE_URL"])

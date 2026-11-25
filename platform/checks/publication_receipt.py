"""Recover a committed Neo4j snapshot on a disposable platform with no media files."""
import os
import sys
import time
import uuid

import requests
from sqlalchemy import create_engine, text


def run(base, neo4j, database):
    def cypher(statement, params):
        reply = requests.post(neo4j + "/db/neo4j/tx/commit",
                              auth=(os.getenv("NEO4J_USER", "neo4j"), os.getenv("NEO4J_PASSWORD", "")),
                              json={"statements": [{"statement": statement, "parameters": params}]}, timeout=15)
        reply.raise_for_status()
        assert reply.json()["errors"] == []

    session = requests.Session()
    response = session.get(base + "/v2/session", timeout=5)
    response.raise_for_status()
    owner = response.json()["workspace_id"]
    engine = create_engine(database)
    try:
        published, unrelated = uuid.uuid4().hex, uuid.uuid4().hex
        with engine.begin() as db:
            for video in (published, unrelated):
                db.execute(text("""
                    INSERT INTO videos(id,title,duration,status,created_at,owner_id)
                    VALUES (:video,'Receipt',5,'analyzed',NOW(),:owner)
                    """), {"video": video, "owner": owner})
        valid = '{"title":"recovered"}'
        heads = {}
        for video, quote, stored in ((published, "queue recovery", valid), (published, "queue invalid", "[]"),
                                     (published, "queue revised", valid), (unrelated, "queue mismatch", valid),
                                     (published, None, valid)):
            job = uuid.uuid4().hex
            matches = video == published and stored == valid
            # Reproduce a graph commit whose MySQL version switch has not happened.
            statement = """
                MERGE (v:VPVideo {id:$video})
                CREATE (v)-[:HAS_ANALYSIS]->(a:VPAnalysis {id:$job,result:$result})
                """
            if quote is not None:
                statement += """
                    CREATE (a)-[:HAS_EVIDENCE]->(:VPEvidence {id:0,source:'speech',start:2.0,end:5.0,
                        text:$quote,frame:''})
                    """
            params = {"video": published, "job": job, "result": stored, "quote": quote}
            cypher(statement, params)
            with engine.begin() as db:
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
                if matches:
                    heads[video] = job
                assert head == heads.get(video)
            if matches:
                assert session.get(base + "/result/" + video, timeout=5).json()["result"]["title"] == "recovered"
                path = base + "/v2/videos/" + video + "/evidence"
                if quote == "queue revised":
                    update = "MATCH (:VPAnalysis {id:$job})-[:HAS_EVIDENCE]->(e) SET e.id=$id,e.text=$text"
                    for index, body in ((2, quote), (None, quote), (0, None), (0, 42)):
                        cypher(update, {"job": job, "id": index, "text": body})
                        reply = session.get(path, params={"q": "queue"}, timeout=5)
                        assert reply.status_code == 503 and reply.json()["success"] is False, (index, body, reply.status_code)
                    cypher(update, {"job": job, "id": 0, "text": quote})
                hits = session.get(path, params={"q": "queue"}, timeout=5)
                hits.raise_for_status()
                assert [hit["text"] for hit in hits.json()["hits"]] == ([] if quote is None else [quote])
        update_result = "MATCH (a:VPAnalysis {id:$job}) SET a.result=$value"
        paths = ["/result/" + published, "/v2/library/videos/" + published]
        for damaged in (42, "[]", "{} trailing"):
            cypher(update_result, {"job": heads[published], "value": damaged})
            for path in paths:
                reply = session.get(base + path, timeout=5)
                assert reply.status_code == 503 and reply.json()["success"] is False, (path, reply.status_code)
        cypher(update_result, {"job": heads[published], "value": valid})
        for path in paths:
            assert session.get(base + path, timeout=5).json()["result"]["title"] == "recovered"
    finally:
        engine.dispose()
        session.close()
    print("PASS recovered intact snapshots and preserved the last publication after invalid receipts")


if __name__ == "__main__":
    run(sys.argv[1].rstrip("/"), sys.argv[2].rstrip("/"), os.environ["PUBLICATION_TEST_DATABASE_URL"])

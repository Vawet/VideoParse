"""Check queue progress past a locked document on a disposable platform with an indexing worker."""
import argparse
import os
import time

import requests
from sqlalchemy import create_engine, text


def check_unconfigured(db, session, url, ready, pending, poll_ms):
    # Seed the checkpoint of a writer using a different embedding space.
    with db.begin() as conn:
        conn.execute(text("""
            UPDATE vp_document SET index_state='ready',indexed_chunks=chunks,
                vector_space='fixture_writer_space',failures=0,lease=NULL WHERE id=:id
            """), {"id": ready})
    time.sleep(3 * poll_ms / 1000)
    with db.connect() as conn:
        rows = {row.id: row for row in conn.execute(text("""
            SELECT id,index_state,indexed_chunks,failures,lease,vector_space
            FROM vp_document WHERE id IN (:ready,:pending)
            """), {"ready": ready, "pending": pending})}
        assert rows[ready][1:] == ("ready", 1, 0, None, "fixture_writer_space"), rows[ready]
        assert rows[pending][1:5] == ("pending", 0, 0, None), rows[pending]
    result = session.post(url + "/ask", json={
        "question": "Second", "documentId": pending, "documentsOnly": True,
    }, timeout=15)
    result.raise_for_status()
    body = result.json()
    assert body["hits"][0]["docId"] == pending and not body["used_vectors"]
    print("PASS unconfigured instance preserves queued and ready documents and serves full-text answers")


def run(base, database_url, unconfigured_poll_ms=None):
    url = base.rstrip("/") + "/v2/documents"
    with requests.Session() as session:
        session.get(base.rstrip("/") + "/v2/session", timeout=5).raise_for_status()

        def upload(name):
            response = session.post(url, files={"file": (name + ".md", "# " + name)}, timeout=10)
            response.raise_for_status()
            return response.json()["document"]["id"]

        def state(doc):
            response = session.get(url + "/" + doc, timeout=5)
            response.raise_for_status()
            return response.json()["document"]["indexState"]

        def await_ready(doc):
            deadline = time.monotonic() + 30
            while (current := state(doc)) != "ready":
                assert current != "error" and time.monotonic() < deadline, (doc, current)
                time.sleep(0.1)

        head, other = upload("First"), upload("Second")
        db = create_engine(database_url)
        try:
            if unconfigured_poll_ms is not None:
                check_unconfigured(db, session, url, head, other, unconfigured_poll_ms)
                return
            await_ready(head)
            await_ready(other)
            # Publish two due times together, then hold the earliest row across worker polls.
            with db.begin() as conn:
                conn.execute(text("""
                    UPDATE vp_document SET index_state='pending',indexed_chunks=0,
                        due_at=TIMESTAMPADD(SECOND,IF(id=:head,2,3),CURRENT_TIMESTAMP(3))
                    WHERE id IN (:head,:other)
                    """), {"head": head, "other": other})
            with db.begin() as lock:
                lock.execute(text("SELECT id FROM vp_document WHERE id=:id FOR UPDATE"), {"id": head}).one()
                assert state(head) == "pending"
                await_ready(other)
                assert state(head) == "pending"
            await_ready(head)
        finally:
            db.dispose()
    print("PASS unlocked document indexed while the queue head was locked, then head recovered")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base")
    parser.add_argument("--unconfigured-poll-ms", type=int,
                        help="For a disposable instance without QDRANT_URL, pass its DOCUMENT_INDEX_MS interval")
    args = parser.parse_args()
    if args.unconfigured_poll_ms is not None and args.unconfigured_poll_ms <= 0:
        parser.error("the polling interval must be positive")
    run(args.base, os.environ["MARKDOWN_EVAL_DATABASE_URL"], args.unconfigured_poll_ms)

"""Check queue progress past a locked document on a disposable platform with an indexing worker."""
import os
import sys
import time

import requests
from sqlalchemy import create_engine, text


def run(base, database_url):
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
        await_ready(head)
        await_ready(other)
        db = create_engine(database_url)
        try:
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
    run(sys.argv[1], os.environ["MARKDOWN_EVAL_DATABASE_URL"])

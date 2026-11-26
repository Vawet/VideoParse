"""Check re-practice and reload on a disposable, model-disabled platform with its MySQL test database."""
import json
import os
import sys
from uuid import uuid4

import requests

from test_account import register
from sqlalchemy import create_engine, text


def run(base, database_url):
    documents = base.rstrip("/") + "/v2/documents"
    with requests.Session() as user:
        register(user, base)
        result = user.post(documents, files={"file": ("分页.md", "游标分页按排序键继续。".encode())}, timeout=10)
        result.raise_for_status()
        doc = result.json()["document"]["id"]
        exercise = uuid4().hex
        # A previously graded exercise also represents a row written before repeat-round support.
        previous = "按排序键继续"
        points = [{"label": "定位", "quote": previous}]
        feedback = {"score": 1, "marks": [{**points[0], "hit": True, "feedback": "正确", "evidence": previous}]}
        db = create_engine(database_url)
        try:
            with db.begin() as conn:
                conn.execute(text("""
                    INSERT INTO vp_doc_interview (id,doc_id,ordinal_no,question,points,revision,answer,feedback)
                    VALUES (:id,:doc,0,'游标如何分页？',:points,1,:previous,:feedback)
                """), {"id": exercise, "doc": doc, "points": json.dumps(points), "previous": previous,
                       "feedback": json.dumps(feedback)})
            path = documents + "/interview"
            scope = {"documentId": doc}

            def current(params):
                response = user.get(path + "/current", params=params, timeout=10)
                response.raise_for_status()
                return response.json()["exercise"]

            def repeat():
                response = user.post(path + "/next", json={**scope, "previousId": exercise}, timeout=10)
                response.raise_for_status()
                return response.json()["exercise"]

            assert current(scope)["answer"] == previous
            question = repeat()
            for view in (question, current(scope), current({})):
                assert view["id"] == exercise
                assert "answer" not in view and "feedback" not in view, "old grading visible in a new round"
            assert question["revision"] > 1
            assert repeat()["revision"] == question["revision"], "retrying next invalidated an unanswered round"
            answer_url = path + "/" + exercise + "/answer"
            for revision in (1, question["revision"]):
                response = user.post(answer_url, json={"revision": revision, "answer": "补充", "supplement": True},
                                     timeout=10)
                assert response.status_code == 409
            with db.connect() as conn:
                assert conn.execute(text("SELECT answer FROM vp_doc_interview WHERE id=:id"),
                                    {"id": exercise}).scalar_one() == previous
        finally:
            db.dispose()
            user.delete(documents + "/" + doc, timeout=10).raise_for_status()
    print("PASS repeat stays blind after reload, saved grading survives and stale supplements are refused")


if __name__ == "__main__":
    run(sys.argv[1], os.environ["MARKDOWN_EVAL_DATABASE_URL"])

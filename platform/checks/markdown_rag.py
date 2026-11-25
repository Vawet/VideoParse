"""Evaluate a disposable platform with local embeddings and text generation disabled."""
import argparse
import os
import time

import requests

NOTES = {
    "学习方法.md": "# 学习方法\n\n## 间隔复习\n把每次回忆之间的时间逐渐拉长，可以提高长期保持率。\n\n"
               "## 费曼法\n向初学者讲解可以发现理解中的漏洞。\n```md\n# 代码里的标题\n```\n",
    "算法笔记.md": "# 归并排序\n先把序列一分为二，递归处理左右两半，再将两个有序序列合并。",
}
CASES = [
    ("间隔复习", "学习方法.md", "间隔复习"),
    ("怎样让知识更长久地保存在记忆中", "学习方法.md", "间隔复习"),
    ("讲给初学者能够帮助我做什么", "学习方法.md", "费曼法"),
    ("归并排序", "算法笔记.md", "归并排序"),
    ("如何将两个有序序列组合在一起", "算法笔记.md", "归并排序"),
]


def run(base):
    owner, outsider = requests.Session(), requests.Session()

    def api(session, verb, path, status=200, **kwargs):
        res = session.request(verb, base.rstrip("/") + "/v2/" + path, timeout=60, **kwargs)
        assert res.status_code == status, (path, res.status_code)
        return res.json()

    def upload(session, name, body):
        files = {"file": (name, body.encode("utf-8"), "text/markdown")}
        return api(session, "POST", "documents", files=files)["document"]

    def ask(question, doc=None):
        return api(owner, "POST", "documents/ask", json={"question": question, "documentId": doc})

    visitor = api(owner, "GET", "session")["workspace_id"]
    api(outsider, "GET", "session")
    # Seed a relevant passage belonging to someone else, so an unscoped search can return it.
    foreign = upload(outsider, "私人.md", "# 间隔复习\n间隔复习如何让知识更长久地保存在记忆中？")
    docs = {name: upload(owner, name, body)["id"] for name, body in NOTES.items()}
    note = docs["学习方法.md"]
    api(outsider, "GET", "documents/" + note, 404)
    api(outsider, "POST", "documents/ask", 404, json={"question": "联网搜资料", "documentId": note})
    for session, doc in [(owner, x) for x in docs.values()] + [(outsider, foreign["id"])]:
        deadline = time.monotonic() + 120
        while True:
            state = api(session, "GET", "documents/" + doc)["document"]["indexState"]
            if state == "ready":
                break
            assert state != "error" and time.monotonic() < deadline, state
            time.sleep(0.5)

    def rank(hits, doc, section):
        return next((i for i, (d, h) in enumerate(hits, 1) if d == doc and section in h), 100)

    scores, baseline = [], []
    engine = None
    if os.getenv("MARKDOWN_EVAL_DATABASE_URL"):
        from sqlalchemy import create_engine, text
        engine = create_engine(os.environ["MARKDOWN_EVAL_DATABASE_URL"])
    try:
        for question, name, section in CASES:
            result = ask(question)
            assert result["source"] == "document" and result["used_vectors"]
            hits = result["hits"]
            assert all(h["docId"] in docs.values() for h in hits)
            for h in hits:
                lines = NOTES[h["name"]].splitlines()[h["firstLine"]-1:h["lastLine"]]
                assert h["body"].strip() in "\n".join(lines)
            scores.append(rank([(h["docId"], h["heading"]) for h in hits], docs[name], section))
            if engine:
                with engine.connect() as conn:
                    rows = conn.execute(text("""
                        SELECT c.doc_id,c.heading FROM vp_doc_chunk c JOIN vp_document d ON d.id=c.doc_id
                        WHERE d.owner_id=:owner AND MATCH(c.heading,c.body) AGAINST(:q IN NATURAL LANGUAGE MODE)
                        ORDER BY MATCH(c.heading,c.body) AGAINST(:q IN NATURAL LANGUAGE MODE) DESC,c.doc_id,c.ordinal_no
                        LIMIT 5
                    """), {"owner": visitor, "q": question})
                    baseline.append(rank(rows, docs[name], section))
        selected = ask("如何向人讲解所学的知识", note)["hits"]
        assert selected and all(h["docId"] == note for h in selected)
    finally:
        if engine:
            engine.dispose()
    for name, ranks in [("全文检索", baseline), ("混合检索", scores)]:
        if ranks:
            print(name, "Hit@1", f"{sum(r == 1 for r in ranks)}/{len(ranks)}",
                  "Hit@3", f"{sum(r <= 3 for r in ranks)}/{len(ranks)}")
    assert all(r <= 3 for r in scores)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", help="独立测试环境 API 地址，会创建访客和笔记")
    run(parser.parse_args().base)

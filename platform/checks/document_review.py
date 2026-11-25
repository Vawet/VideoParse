"""Exercise document recall on a disposable platform instance."""
from concurrent.futures import ThreadPoolExecutor
import sys
import time

import requests


def run(base):
    api = base.rstrip("/") + "/v2"
    owner, other = requests.Session(), requests.Session()
    for session in (owner, other):
        session.get(api + "/session", timeout=10).raise_for_status()

    sample = "# 记忆\n从记忆中提取有助于学习。\n## 间隔\n把练习分散到多天。"
    response = owner.post(api + "/documents", files={"file": ("复习.md", sample.encode())}, timeout=10)
    response.raise_for_status()
    doc = response.json()["document"]["id"]
    queue = api + "/documents/review"
    add = api + f"/documents/{doc}/chunks/1/review"
    question = {"question": "为什么要把练习分开？"}

    assert other.post(add, json=question, timeout=10).status_code == 404
    # Independent requests with the same visitor cookie simulate concurrent browser tabs.
    def concurrent_posts(url, payload):
        with ThreadPoolExecutor(2) as pool:
            return sorted(pool.map(lambda _: requests.post(url, json=payload, cookies=owner.cookies,
                                                            timeout=10).status_code, range(2)))

    assert concurrent_posts(add, question) == [200, 200]
    def next_card(document=None, session=owner):
        response = session.get(queue, params={"documentId": document}, timeout=10)
        response.raise_for_status()
        return response.json()["next"]
    card = next_card()
    assert card["total"] == card["dueCount"] == 1 and card["question"] == question["question"]
    assert card["firstLine"] == 3 and card["lastLine"] == 4 and card["body"] in sample
    assert other.get(queue, timeout=10).json()["next"] is None
    url = queue + "/" + card["id"]
    rate = url + "/rate"
    feedback = {"revision": 0, "rating": "again"}
    assert other.post(rate, json=feedback, timeout=10).status_code == 404
    assert concurrent_posts(rate, feedback) == [200, 409]
    # Saving the same citation again preserves its recall schedule and original question.
    owner.post(add, json={"question": "另一道题"}, timeout=10).raise_for_status()
    later = next_card()
    assert later["revision"] == 1 and later["dueCount"] == 0 and later["question"] == card["question"]
    assert abs(later["dueEpoch"] - time.time() - 600) < 20
    assert owner.post(rate, json={"revision": 1, "rating": "remembered"}, timeout=10).status_code == 409
    other.delete(url, timeout=10).raise_for_status()
    assert next_card()["id"] == card["id"]
    owner.delete(url, timeout=10).raise_for_status()
    assert next_card() is None
    owner.post(add, json=question, timeout=10).raise_for_status()
    new_card = next_card()
    assert new_card["id"] != card["id"]
    assert owner.post(rate, json=feedback, timeout=10).status_code == 404
    owner.post(queue + "/" + new_card["id"] + "/rate",
               json={"revision": 0, "rating": "remembered"}, timeout=10).raise_for_status()
    assert abs(next_card()["dueEpoch"] - time.time() - 86400) < 20

    another = owner.post(api + "/documents", files={"file": ("图论.md", "# 图论\n图由顶点和边组成。".encode())}, timeout=10)
    another.raise_for_status()
    graph = another.json()["document"]["id"]
    assert next_card(graph) is None
    owner.post(api + f"/documents/{graph}/chunks/0/review", json={"question": "图由什么组成？"}, timeout=10).raise_for_status()
    global_card = next_card()
    assert (global_card["docId"], global_card["dueCount"], global_card["total"]) == (graph, 1, 2)
    for document, due in [(doc, 0), (graph, 1)]:
        scoped = next_card(document)
        assert (scoped["docId"], scoped["dueCount"], scoped["total"]) == (document, due, 1)
        assert next_card(document, other) is None
    path = api + "/documents/" + graph
    new_name = {"name": "图论复习.md"}
    assert other.patch(path, json=new_name, timeout=10).status_code == 404
    assert other.delete(path, timeout=10).status_code == 404
    owner.patch(path, json=new_name, timeout=10).raise_for_status()
    assert next_card(graph)["name"] == new_name["name"]
    owner.delete(path, timeout=15).raise_for_status()
    assert owner.get(path, timeout=10).status_code == 404
    assert next_card(graph) is None and next_card()["docId"] == doc
    print("PASS private global and single-document queues, counts, citation lines, concurrent feedback and recall timing")


if __name__ == "__main__":
    run(sys.argv[1])

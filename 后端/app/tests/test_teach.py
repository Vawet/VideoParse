import pytest

from app import retrieval
from app.db import repo
from app.services import teach

VA = [{"start_time": 0, "end_time": 30, "text": "梯度下降沿着损失函数的负梯度方向更新参数。"},
      {"start_time": 30, "end_time": 60, "text": "学习率太大会导致训练震荡而不收敛。"}]
VB = [{"start_time": 0, "end_time": 30, "text": "反向传播利用链式法则逐层计算每个参数的梯度。"}]


@pytest.fixture
def course(learn_env):
    retrieval.invalidate()
    repo.register_video("va", "第1讲 梯度下降")
    repo.register_video("vb", "第2讲 反向传播")
    repo.index_video("va", VA)
    repo.index_video("vb", VB)
    c = repo.create_course("机器学习")
    repo.add_video_to_course(c["id"], "va")
    repo.add_video_to_course(c["id"], "vb")
    return c["id"]


def P(text, vid, start, quote):
    return {"text": text, "video_id": vid, "start": start, "quote": quote}


GOOD = [
    {"title": "梯度下降", "minutes": 20, "points": [
        P("沿负梯度方向更新", "va", "00:00:00", "沿着损失函数的负梯度方向更新参数"),
        P("编造的要点", "va", "00:00:10", "这句话在字幕里根本不存在的内容")]},
    {"title": "学习率", "minutes": 10, "points": [P("学习率过大会震荡", "va", "00:00:40", "学习率太大会导致训练震荡而不收敛")]},
    {"title": "空环节", "minutes": 5, "points": [P("无依据", "vb", "00:00:00", "完全不存在的原话在这里出现过吗")]},
]


def test_allocate_minutes_exact_sum_and_minimum():
    for w, total in [([20, 10, 5], 45), ([1, 1, 1], 10), ([3], 7), ([0, 0], 5), ([100, 1, 1], 6)]:
        out = teach.allocate_minutes(w, total)
        assert sum(out) == total and min(out) >= 1 and all(isinstance(x, int) for x in out)
    assert teach.allocate_minutes([2, 1], 30) == [20, 10]
    with pytest.raises(ValueError):
        teach.allocate_minutes([1, 1, 1], 2)


def test_make_plan_verifies_evidence_aligns_time_and_builds_slides(course):
    calls = []

    def fake(messages, **kw):
        calls.append(messages)
        if "教研老师" in messages[0]["content"]:
            return {"sections": GOOD}
        return {"questions": [{"qtype": "judge", "stem": "学习率过大会震荡", "answer": "对", "topic": "学习率", "explanation": "",
                               "evidence": [{"start": "00:00:30", "quote": "学习率太大会导致训练震荡而不收敛"}]}]}

    out = teach.make_plan(course, "梯度下降", minutes=45, homework_count=1, chat_json=fake)
    assert out["ok"]
    assert [s["title"] for s in out["sections"]] == ["梯度下降", "学习率"]  # 无依据的环节整体丢弃
    assert out["dropped_points"] == 2                                       # 两个编造要点被丢弃
    assert sum(s["minutes"] for s in out["sections"]) == 45 and out["time_adjusted"] is True
    assert out["sections"][0]["points"][0]["evidence"]["time"] == "00:00:00"
    titles = [s["title"] for s in out["slides"]]
    assert titles[0] == "梯度下降" and titles[-1] == "小结" and len(titles) == 4
    assert "第1讲 梯度下降 00:00:00" in out["slides"][1]["notes"]
    assert out["homework"]["quiz_id"] and out["homework"]["questions"][0]["answer"] == "对"
    assert repo.get_teach_plan(out["plan_id"])["version"] == 1


def test_make_plan_refusals(course):
    boom = lambda m, **kw: 1 / 0
    out = teach.make_plan(course, "区块链", chat_json=boom)
    assert not out["ok"] and "没有找到" in out["reason"]
    all_fake = lambda m, **kw: {"sections": [{"title": "x", "minutes": 5, "points": [P("t", "va", "0", "根本不存在的一句原话哦哦哦")]}]}
    out = teach.make_plan(course, "梯度下降", chat_json=all_fake, homework_count=0)
    assert not out["ok"] and "证据校验" in out["reason"]
    with pytest.raises(ValueError):
        teach.make_plan(course, "梯度下降", minutes=2, chat_json=all_fake)
    with pytest.raises(ValueError):
        teach.make_plan("nope", "x", chat_json=all_fake)


def test_revise_creates_new_version_and_history(course):
    base = lambda m, **kw: {"sections": GOOD[:2]}
    first = teach.make_plan(course, "梯度下降", minutes=45, homework_count=0, chat_json=base)
    shorter = lambda m, **kw: {"sections": [GOOD[1]]}
    v2 = teach.revise_plan(first["plan_id"], "只讲学习率，压缩到 30 分钟", minutes=30, chat_json=shorter)
    assert v2["ok"] and v2["version"] == 2 and v2["parent_id"] == first["plan_id"]
    assert [s["minutes"] for s in v2["sections"]] == [30] and v2["minutes"] == 30
    assert repo.get_teach_plan(first["plan_id"])["plan"]["minutes"] == 45   # 旧版本不被覆盖
    assert [h["version"] for h in repo.teach_plan_history(v2["plan_id"])] == [2, 1]

    bad = teach.revise_plan(v2["plan_id"], "加点内容", chat_json=lambda m, **kw: {"sections": [
        {"title": "编", "minutes": 5, "points": [P("t", "va", "0", "没有的原话没有的原话没有的原话")]}]})
    assert not bad["ok"] and "保留原方案" in bad["reason"]
    with pytest.raises(ValueError):
        teach.revise_plan("zzz", "x", chat_json=base)


def test_http_teach_flow(course, monkeypatch):
    from app import main
    from app.services import llm

    monkeypatch.setattr(llm, "chat_json", lambda m, **kw: {"sections": GOOD[:2]})
    c = main.app.test_client()
    r = c.post("/teach/plan", json={"course_id": course, "topic": "梯度下降", "minutes": 40, "homework_count": 0}).get_json()
    assert r["success"] and sum(s["minutes"] for s in r["plan"]["sections"]) == 40
    pid = r["plan"]["plan_id"]
    assert c.get(f"/teach/plan/{pid}").get_json()["plan"]["slides"]
    r2 = c.post(f"/teach/plan/{pid}/revise", json={"instruction": "再精简一点", "minutes": 30}).get_json()
    assert r2["success"] and r2["plan"]["version"] == 2
    assert [h["version"] for h in c.get(f"/teach/plan/{r2['plan']['plan_id']}").get_json()["history"]] == [2, 1]

    assert c.post("/teach/plan", json={"course_id": course, "topic": "区块链"}).get_json()["success"] is False
    assert c.post("/teach/plan", json={"course_id": "zzz", "topic": "x"}).status_code == 404
    assert c.post("/teach/plan", json={"course_id": course}).get_json()["success"] is False
    assert c.post(f"/teach/plan/{pid}/revise", json={}).get_json()["success"] is False
    assert c.post("/teach/plan/zzz/revise", json={"instruction": "x"}).status_code == 404
    assert c.get("/teach/plan/zzz").status_code == 404

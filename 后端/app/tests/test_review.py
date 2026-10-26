import datetime as dt

import pytest

from app import retrieval
from app.agent import tools
from app.agent.state import CourseWorkspace
from app.db import repo
from app.services import review

TODAY = dt.date(2026, 1, 1)


def _quiz(video_id, topic, start, quote, n=1):
    qs = [{"qtype": "judge", "stem": f"{topic}{i}", "options": None, "answer": "对", "explanation": "",
           "topic": topic, "verified": True,
           "evidence": [{"video_id": video_id, "start": start, "end": start + 20, "quote": quote}]} for i in range(n)]
    return repo.save_quiz(video_id, None, topic, "medium", qs)["questions"]


@pytest.fixture
def setup(learn_env):
    retrieval.invalidate()
    repo.register_video("va", "第1讲", duration=600)
    repo.register_video("vb", "第2讲", duration=1200)
    c = repo.create_course("机器学习")
    repo.add_video_to_course(c["id"], "va")
    repo.add_video_to_course(c["id"], "vb")
    return c["id"]


def test_weak_topics_use_latest_attempt_and_scope(setup):
    q_grad = _quiz("va", "梯度下降", 30, "沿负梯度方向更新", n=2)
    q_bp = _quiz("vb", "反向传播", 60, "链式法则逐层计算")
    for q in q_grad:
        repo.record_attempt("u1", q["id"], "错", False)
    repo.record_attempt("u1", q_bp[0]["id"], "对", True)
    repo.record_attempt("u2", q_grad[0]["id"], "对", True)  # 别人的记录不串

    out = repo.weak_topics("u1", course_id=setup)
    assert out["attempted"] == 3
    top = out["topics"][0]
    assert top["topic"] == "梯度下降" and top["weak"] and top["wrong"] == 2 and top["accuracy"] == 0.0
    assert top["evidence"][0]["video_id"] == "va"
    assert [t["weak"] for t in out["topics"]] == [True, False]

    repo.record_attempt("u1", q_grad[0]["id"], "对", True)  # 重做对了 → 只剩 1 道错
    assert repo.weak_topics("u1", course_id=setup)["topics"][0]["wrong"] == 1
    assert repo.weak_topics("u1", video_id="vb")["attempted"] == 1  # 单视频范围
    assert repo.weak_topics("nobody", course_id=setup)["attempted"] == 0


def test_plan_prioritises_weak_points_respects_budget_and_keeps_evidence(setup):
    q = _quiz("va", "梯度下降", 30, "沿负梯度方向更新")[0]
    repo.record_attempt("u1", q["id"], "错", False)
    plan = review.build_plan("u1", setup, today=TODAY, exam_date=TODAY + dt.timedelta(days=3), daily_minutes=20)

    assert len(plan["days"]) == 4 and plan["days"][0]["date"] == "2026-01-01"
    first = plan["days"][0]["items"][0]
    assert first["type"] == "weak" and first["topic"] == "梯度下降"
    assert first["video_id"] == "va" and first["time"] == "00:00:30" and first["quote"] == "沿负梯度方向更新"
    assert all(d["minutes"] <= 20 or len(d["items"]) == 1 for d in plan["days"])  # 单项超预算才允许
    assert plan["days"][-1]["items"][0]["type"] == "quiz"                         # 末日自测
    watch = [i for d in plan["days"] for i in d["items"] if i["type"] == "watch"]
    assert {i["video_id"] for i in watch} == {"vb"}  # 没做过题的视频走通读；va 已被薄弱点覆盖
    assert plan["weak_topics"] == ["梯度下降"]


def test_plan_without_exam_date_defaults_and_done_items_are_removed(setup):
    plan = review.build_plan("u1", setup, today=TODAY)
    assert len(plan["days"]) == 7
    item = next(i for d in plan["days"] for i in d["items"] if i["type"] == "watch")
    repo.set_item_done("u1", setup, item["id"])
    again = review.build_plan("u1", setup, today=TODAY)
    assert item["id"] not in [i["id"] for d in again["days"] for i in d["items"]]
    repo.set_item_done("u1", setup, item["id"], done=False)
    assert repo.get_profile("u1", setup)["done_items"] == []


def test_plan_overflow_and_errors(setup):
    plan = review.build_plan("u1", setup, today=TODAY, exam_date=TODAY, daily_minutes=5)
    assert len(plan["days"]) == 1 and len(plan["overflow"]) >= 1   # 一天 5 分钟装不下第二个视频
    with pytest.raises(ValueError):
        review.build_plan("u1", setup, today=TODAY, exam_date=TODAY - dt.timedelta(days=1))
    with pytest.raises(ValueError):
        review.build_plan("u1", "nope", today=TODAY)


def test_tips_drop_timestamps_and_survive_llm_failure(setup):
    plan = review.build_plan("u1", setup, today=TODAY)
    review.add_tips(plan, chat_json=lambda m, **kw: {"tips": [{"day": 1, "tip": "先看 12:30 处"}, {"day": 2, "tip": "加油，先看概念"}]})
    assert plan["days"][0]["tip"] == "" and plan["days"][1]["tip"] == "加油，先看概念"
    review.add_tips(plan, chat_json=lambda m, **kw: 1 / 0)  # 不抛异常


def test_review_tools_need_client_id(setup):
    ws = CourseWorkspace(setup)
    assert "error" in tools.run_tool("get_weak_topics", ws, {}, "course")
    ws.client_id = "u1"
    assert tools.run_tool("get_weak_topics", ws, {}, "course")["topics"] == []
    q = _quiz("va", "梯度下降", 30, "沿负梯度方向更新")[0]
    repo.record_attempt("u1", q["id"], "错", False)
    assert tools.run_tool("get_weak_topics", ws, {}, "course")["topics"][0]["topic"] == "梯度下降"
    out = tools.run_tool("build_review_plan", ws, {"daily_minutes": 30}, "course")
    assert out["weak_topics"] == ["梯度下降"] and out["days"][0]["items"][0]["time"] == "00:00:30"
    assert "error" in tools.run_tool("build_review_plan", ws, {"exam_date": "2000-01-01"}, "course")


def test_http_review_endpoints(setup, monkeypatch):
    from app import main
    from app.services import llm

    monkeypatch.setattr(llm, "chat_json", lambda m, **kw: {"tips": []})
    c = main.app.test_client()
    q = _quiz("va", "梯度下降", 30, "沿负梯度方向更新")[0]
    repo.record_attempt("u1", q["id"], "错", False)

    w = c.get(f"/review/weak?client_id=u1&course_id={setup}").get_json()
    assert w["success"] and w["topics"][0]["weak"]
    assert c.get("/review/weak").get_json()["success"] is False

    future = (dt.date.today() + dt.timedelta(days=2)).isoformat()
    p = c.post("/review/plan", json={"client_id": "u1", "course_id": setup, "exam_date": future, "daily_minutes": 30}).get_json()
    assert p["success"] and len(p["plan"]["days"]) == 3
    assert repo.get_profile("u1", setup)["exam_date"] == future            # 偏好被保存
    p2 = c.post("/review/plan", json={"client_id": "u1", "course_id": setup, "use_llm": False}).get_json()
    assert p2["plan"]["exam_date"] == future and p2["plan"]["daily_minutes"] == 30  # 复用已存档设置

    item = p["plan"]["days"][0]["items"][0]["id"]
    assert c.post("/review/done", json={"client_id": "u1", "course_id": setup, "item_id": item}).get_json()["success"]
    assert item in repo.get_profile("u1", setup)["done_items"]
    assert c.post("/review/plan", json={"client_id": "u1", "course_id": setup, "exam_date": "bad"}).get_json()["success"] is False
    assert c.post("/review/plan", json={"client_id": "u1", "course_id": "zzz"}).status_code == 404

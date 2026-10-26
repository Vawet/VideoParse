import pytest

from app import retrieval
from app.agent import loop, tools
from app.agent.state import CourseWorkspace
from app.db import repo

A = [{"start_time": 0, "end_time": 20, "text": "梯度下降沿着负梯度方向更新参数，学习率控制步长。"}]
B = [{"start_time": 0, "end_time": 20, "text": "反向传播利用链式法则逐层计算梯度。"}]


@pytest.fixture
def course(learn_env):
    retrieval.invalidate()
    repo.register_video("va", "第1讲 梯度下降")
    repo.register_video("vb", "第2讲 反向传播")
    repo.index_video("va", A)
    repo.index_video("vb", B)
    c = repo.create_course("机器学习")
    repo.add_video_to_course(c["id"], "va")
    repo.add_video_to_course(c["id"], "vb")
    return c["id"]


def test_course_tools(course):
    ws = CourseWorkspace(course)
    vids = tools.run_tool("list_course_videos", ws, {}, "course")["videos"]
    assert {v["video_title"] for v in vids} == {"第1讲 梯度下降", "第2讲 反向传播"}
    hits = tools.run_tool("search_course", ws, {"query": "链式法则"}, "course")["hits"]
    assert hits[0]["video_id"] == "vb" and hits[0]["video_title"] == "第2讲 反向传播"
    assert "note" in tools.run_tool("search_course", ws, {"query": "区块链"}, "course")
    win = tools.run_tool("get_video_window", ws, {"video_id": "va", "start": "0", "end": "10"}, "course")
    assert "学习率" in win["segments"][0]["text"]
    assert "error" in tools.run_tool("get_video_window", ws, {"video_id": "vid-learn", "start": "0", "end": "9"}, "course")
    # 单视频问答不应看到课程工具，反之亦然
    assert "error" in tools.run_tool("search_course", ws, {"query": "x"}, "chat")


def test_course_citations_validate_title_and_time(course):
    videos = [{"id": "va", "title": "第1讲 梯度下降", "segments": repo.get_transcript("va")},
              {"id": "vb", "title": "第2讲 反向传播", "segments": repo.get_transcript("vb")}]
    cites = loop.extract_course_citations(
        "梯度下降见 [第1讲 梯度下降 00:05]；反向传播见【第2讲 反向传播 00:10】；编造 [第9讲 不存在 00:01]；越界 [第1讲 梯度下降 09:00]",
        videos)
    ok = [c for c in cites if c["valid"]]
    assert [(c["video_id"], c["seconds"]) for c in ok] == [("va", 5), ("vb", 10)]
    assert len(cites) == 4 and not any(c["valid"] for c in cites[2:])


def test_chat_with_course_retries_without_citation(course, monkeypatch):
    answers = iter(["两讲都讲了梯度。", "梯度下降 [第1讲 梯度下降 00:05]，反向传播 [第2讲 反向传播 00:10]。"])
    seen = []

    def fake(group, ws, messages, emit, max_steps=0):
        seen.append(group)
        return next(answers)

    monkeypatch.setattr(loop, "run_agent", fake)
    answer, history, cites = loop.chat_with_course(course, [], "两讲有什么联系？")
    assert seen == ["course", "course"] and len([c for c in cites if c["valid"]]) == 2
    assert history[-1]["content"] == answer
    with pytest.raises(ValueError):
        loop.chat_with_course("nope", [], "?")


def test_http_courses_flow_and_course_chat(learn_env, monkeypatch):
    from app import main

    c = main.app.test_client()
    cid = c.post("/courses", json={"name": "机器学习"}).get_json()["course"]["id"]
    assert c.post("/courses", json={"name": " "}).get_json()["success"] is False
    assert c.post(f"/courses/{cid}/videos", json={"video_id": "ghost"}).status_code == 404
    assert c.post("/courses/zzz/videos", json={"video_id": "vid-learn"}).status_code == 404

    r = c.post(f"/courses/{cid}/videos", json={"video_id": "vid-learn"}).get_json()
    assert [v["id"] for v in r["course"]["videos"]] == ["vid-learn"]
    assert c.get(f"/courses/{cid}").get_json()["course"]["name"] == "机器学习"
    assert c.get("/courses/zzz").status_code == 404
    assert c.get("/courses").get_json()["courses"][0]["video_count"] == 1

    monkeypatch.setattr(loop, "run_agent", lambda *a, **k: "课程中未提及")
    r = c.post("/chat", json={"course_id": cid, "question": "区块链？"}).get_json()
    assert r["success"] and r["answer"] == "课程中未提及"
    assert c.post("/chat", json={"course_id": "zzz", "question": "?"}).status_code == 404
    assert c.post("/chat", json={"question": "?"}).get_json()["success"] is False

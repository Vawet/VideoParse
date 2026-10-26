"""离线测试：不需要 ffmpeg / whisper / CLIP / 千问 key。

用「脚本化的假 LLM」驱动真实的 Agent 循环和工具注册表，其余重依赖（ffmpeg、Whisper、
千问文本/视觉能力）通过 monkeypatch 替换成确定性的假实现。
运行：cd 后端 && python -m pytest app/tests/test_agent_offline.py -v
"""
import json
import os
import sys
import types

import pytest

from app import config


# ------------------------------------------------------------------ 假 LLM
class _Fn:
    def __init__(self, name, args):
        self.name, self.arguments = name, json.dumps(args)


class _Call:
    def __init__(self, i, name, args):
        self.id, self.function = f"call_{i}", _Fn(name, args)


class _Msg:
    def __init__(self, content=None, calls=None):
        self.content, self.tool_calls = content, calls


class FakeClient:
    """按脚本依次返回：每个元素是 (name, args) 列表（一轮工具调用）或字符串（最终回复）。"""

    def __init__(self, script):
        self.script, self.i, self.seen = list(script), 0, []
        self.chat = types.SimpleNamespace(completions=types.SimpleNamespace(create=self._create))

    def _create(self, model, messages, tools=None, **kw):
        self.seen.append([m["role"] for m in messages])
        step = self.script[self.i]
        self.i += 1
        if isinstance(step, str):
            msg = _Msg(content=step)
        else:
            msg = _Msg(calls=[_Call(f"{self.i}_{n}", name, args) for n, (name, args) in enumerate(step)])
        return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])


# ------------------------------------------------------------------ 环境 fixture
@pytest.fixture
def env(tmp_path, monkeypatch):
    for attr in ("UPLOAD_FOLDER", "FRAMES_FOLDER", "AUDIO_FOLDER", "OUTPUT_FOLDER"):
        d = tmp_path / attr
        d.mkdir()
        monkeypatch.setattr(config, attr, str(d))

    from app.db import session as db_session
    monkeypatch.setattr(config, "DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    db_session.reset_engine()
    monkeypatch.setattr(config, "ANALYZE_MODE", "agent")  # 既有测试覆盖 Agent 全程模式；流水线模式的测试单独切换
    video_id = "vid-123"
    (tmp_path / "UPLOAD_FOLDER" / f"{video_id}.mp4").write_bytes(b"fake")

    from app.services import asr, llm, media

    monkeypatch.setattr(media, "get_video_duration", lambda p: 120.0)
    monkeypatch.setattr(media, "has_audio_stream", lambda p: True)
    monkeypatch.setattr(media, "extract_audio_from_video", lambda p, vid: str(tmp_path / "a.wav"))

    def fake_frames(video_path, fps, vid):
        d = os.path.join(config.FRAMES_FOLDER, vid)
        os.makedirs(d, exist_ok=True)
        for i in range(1, 9):
            open(os.path.join(d, f"{i:04d}.png"), "wb").write(b"png")
        return d

    monkeypatch.setattr(media, "split_video_to_frames", fake_frames)

    def fake_capture(video_path, vid, sec, name):
        d = os.path.join(config.FRAMES_FOLDER, vid)
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, name)
        open(p, "wb").write(b"png")
        return p

    monkeypatch.setattr(media, "capture_frame_at", fake_capture)

    segs = [{"start_time": 0.0, "end_time": 10.0, "text": "大家好今天讲Transformer"},
            {"start_time": 10.0, "end_time": 30.0, "text": "注意力机制是核心"},
            {"start_time": 30.0, "end_time": 60.0, "text": "最后总结一下"}]
    monkeypatch.setattr(asr, "speech_to_text", lambda p: (segs, "".join(s["text"] for s in segs)))
    monkeypatch.setattr(llm, "correct_text", lambda s: ("".join(x["text"] for x in s), s))
    monkeypatch.setattr(llm, "semantic_divide", lambda s, d=0: (
        [{"title": "引入", "time_range": {"start_time": "00:00:00", "end_time": "00:00:30"}, "summary": ["a", "b", "c"]}],
        [{"title": "重点", "time_range": {"start_time": "00:00:10", "end_time": "00:00:20"}}]))
    monkeypatch.setattr(llm, "generate_summary", lambda t: {"summary": "该视频主要讲述了Transformer", "highlights": ["注意力"]})
    monkeypatch.setattr(llm, "generate_mind_map", lambda t: {"mind_map": {"config": {}, "data": {"id": "root", "children": []}}})
    monkeypatch.setattr(llm, "analyze_frame", lambda path, caps, url="": {"notes": {"content": f"# 笔记\n![画面]({url})"}})
    monkeypatch.setattr(llm, "ask_about_image", lambda path, q: "画面是一张注意力矩阵图")

    fake_ppt = types.ModuleType("app.actions.generate_ppt")

    def fake_generate_ppt(folder, threshold_input):  # 去重：只保留 1、4、7 号帧
        for f in os.listdir(folder):
            if f.endswith(".png") and f[:4].isdigit() and int(f[:4]) not in (1, 4, 7):
                os.remove(os.path.join(folder, f))

    fake_ppt.generate_ppt = fake_generate_ppt
    monkeypatch.setitem(sys.modules, "app.actions.generate_ppt", fake_ppt)
    yield types.SimpleNamespace(video_id=video_id, tmp=tmp_path)
    db_session.reset_engine()


def _use_client(monkeypatch, script):
    client = FakeClient(script)
    monkeypatch.setattr(config, "get_client", lambda: client)
    return client


FULL_FLOW = [
    [("get_video_info", {})],
    [("transcribe", {}), ],
    [("correct_transcript", {})],
    [("analyze_structure", {}), ("generate_summary", {}), ("generate_mindmap", {})],
    [("extract_keyframes", {"strategy": "slides"})],
    [("extract_heavy_frames", {}), ("write_frame_notes", {})],
    [("validate_result", {})],
    [("finish", {"note": "ok"})],
]


# ------------------------------------------------------------------ 测试
def test_full_agent_flow_produces_frontend_compatible_result(env, monkeypatch):
    from app.agent import loop
    from app.agent.state import Workspace

    client = _use_client(monkeypatch, FULL_FLOW)
    ws = Workspace(env.video_id, "http://h:5000")
    events = []
    loop.analyze_video(ws, events.append)

    result = json.load(open(ws.result_path, encoding="utf-8"))
    assert set(result) >= {"summary", "highlights", "segments", "division", "heavys", "mind_map"}
    assert result["summary"].startswith("该视频")
    assert len(result["segments"]) == 3  # 去重后只剩 3 个关键帧
    seg = result["segments"][0]
    assert seg["image"] == f"http://h:5000/frames/{env.video_id}/0001.png"
    assert seg["time_range"] == "0:00:00 - 0:00:09"
    assert os.path.exists(os.path.join(config.FRAMES_FOLDER, env.video_id, "heavy1.png"))
    assert [e["tool"] for e in events if e["type"] == "tool_start"][0] == "get_video_info"
    assert client.i == len(FULL_FLOW)


def test_frame_time_ranges_use_next_keyframe_as_end(env, monkeypatch):
    from app.agent import loop
    from app.agent.state import Workspace

    _use_client(monkeypatch, FULL_FLOW)
    ws = Workspace(env.video_id)
    loop.analyze_video(ws)
    segs = json.load(open(ws.result_path, encoding="utf-8"))["segments"]
    # 120s 视频 → 间隔 3s → fps=1/3；关键帧 1,4,7 → 起点 0s, 9s, 18s；最后一帧到视频结尾 120s
    assert [s["time_range"] for s in segs] == ["0:00:00 - 0:00:09", "0:00:09 - 0:00:18", "0:00:18 - 0:02:00"]


def test_tool_error_is_fed_back_and_agent_can_recover(env, monkeypatch):
    from app.agent import loop
    from app.agent.state import Workspace

    script = [
        [("write_frame_notes", {})],            # 还没截帧 → error
        [("extract_keyframes", {"strategy": "interval", "max_frames": 4})],
        [("write_frame_notes", {})],
        [("finish", {"note": "recovered"})],
    ]
    _use_client(monkeypatch, script)
    ws = Workspace(env.video_id)
    events = []
    loop.analyze_video(ws, events.append)
    ends = [e for e in events if e["type"] == "tool_end"]
    assert ends[0]["ok"] is False and "extract_keyframes" in ends[0]["observation"]["error"]
    assert ends[2]["ok"] is True
    assert len(json.load(open(ws.result_path, encoding="utf-8"))["segments"]) == 4


def test_finish_fallback_when_agent_never_finishes(env, monkeypatch):
    from app.agent import loop
    from app.agent.state import Workspace

    _use_client(monkeypatch, [[("get_video_info", {})], "我做完了"])  # 没调用 finish
    ws = Workspace(env.video_id)
    loop.analyze_video(ws)
    result = json.load(open(ws.result_path, encoding="utf-8"))
    assert "自动汇总" in result["agent_note"]


def test_unknown_and_invalid_tool_calls_do_not_crash(env, monkeypatch):
    from app.agent import tools
    from app.agent.state import Workspace

    ws = Workspace(env.video_id)
    assert "error" in tools.run_tool("nope", ws, {}, "analyze")
    assert "error" in tools.run_tool("extract_keyframes", ws, {}, "analyze")           # 缺必填参数
    assert "error" in tools.run_tool("capture_frame", ws, {"time": "1"}, "analyze")      # 分析 Agent 不能用问答工具


def test_validate_result_reports_missing_pieces(env):
    from app.agent import tools
    from app.agent.state import Workspace

    ws = Workspace(env.video_id)
    tools.run_tool("get_video_info", ws, {}, "analyze")
    tools.run_tool("transcribe", ws, {}, "analyze")
    r = tools.run_tool("validate_result", ws, {}, "analyze")
    assert r["ok"] is False
    problems = " ".join(i["problem"] for i in r["issues"])
    assert "摘要" in problems and "脑图" in problems and "关键帧" in problems


def test_search_transcript_and_chat_agent(env, monkeypatch):
    from app.agent import loop, tools
    from app.agent.state import Workspace

    ws = Workspace(env.video_id)
    for t in ("get_video_info", "transcribe"):
        tools.run_tool(t, ws, {}, "analyze")
    hits = tools.run_tool("search_transcript", ws, {"query": "注意力"}, "chat")["hits"]
    assert hits and hits[0]["time"] == "00:00:10"

    script = [
        [("search_transcript", {"query": "注意力机制"})],
        [("capture_frame", {"time": "00:00:10"})],
        [("view_frame", {"frame": "cap_10.png", "question": "画面是什么"})],
        "在 00:10 讲到注意力机制，画面是一张注意力矩阵图。",
    ]
    _use_client(monkeypatch, script)
    answer, history, cites = loop.chat_with_video(ws, [], "注意力机制在哪讲的？")
    assert "00:10" in answer
    assert cites and cites[0]["valid"] and cites[0]["seconds"] == 10
    assert history[-2:] == [{"role": "user", "content": "注意力机制在哪讲的？"},
                            {"role": "assistant", "content": answer}]


def test_view_frame_blocks_path_traversal(env):
    from app.agent import tools
    from app.agent.state import Workspace

    ws = Workspace(env.video_id)
    r = tools.run_tool("view_frame", ws, {"frame": "../../etc/passwd", "question": "?"}, "chat")
    assert "error" in r


def test_workspace_rejects_bad_video_id(env):
    from app.agent.state import Workspace

    with pytest.raises(ValueError):
        Workspace("../evil")


def test_agent_max_steps_guard(env, monkeypatch):
    from app.agent import loop
    from app.agent.state import Workspace

    _use_client(monkeypatch, [[("get_video_info", {})]] * 5)
    ws = Workspace(env.video_id)
    with pytest.raises(RuntimeError):
        loop.run_agent("analyze", ws, [{"role": "user", "content": "x"}], max_steps=3)


# ------------------------------------------------------------------ HTTP 层
def test_http_async_analyze_sse_and_result(env, monkeypatch):
    from app import main

    _use_client(monkeypatch, FULL_FLOW)
    c = main.app.test_client()
    r = c.post("/analyze", json={"filepath": f"{env.video_id}.mp4", "async": True}).get_json()
    assert r["success"] and r["video_id"] == env.video_id

    body = c.get(f"/tasks/{r['task_id']}/events").get_data(as_text=True)
    events = [json.loads(l[6:]) for l in body.splitlines() if l.startswith("data: ")]
    assert events[-1] == {**events[-1], "type": "end", "status": "done"}
    assert any(e["type"] == "tool_end" and e["tool"] == "finish" for e in events)

    res = c.get(f"/result/{env.video_id}").get_json()
    assert res["success"] and res["result"]["summary"]
    assert res["result"]["segments"][0]["image"].startswith("http://localhost")


def test_http_sync_analyze_is_backward_compatible(env, monkeypatch):
    from app import main

    _use_client(monkeypatch, FULL_FLOW)
    c = main.app.test_client()
    # 旧前端只传 filepath，不传 video_id
    r = c.post("/analyze", json={"filepath": f"{env.video_id}.mp4"}).get_json()
    assert r["success"] and r["video_id"] == env.video_id and "mind_map" in r["result"]

    frames = c.get(f"/frames/{env.video_id}").get_json()
    assert frames["heavy"] == [f"/frames/{env.video_id}/heavy1.png"]
    assert all("cap_" not in p for p in frames["ppt"])


def test_http_chat_and_errors(env, monkeypatch):
    from app import main
    from app.agent import tools
    from app.agent.state import Workspace

    ws = Workspace(env.video_id)
    for t in ("get_video_info", "transcribe"):
        tools.run_tool(t, ws, {}, "analyze")
    _use_client(monkeypatch, [[("search_transcript", {"query": "总结"})], "最后在 00:30 做了总结"])
    c = main.app.test_client()
    r = c.post("/chat", json={"video_id": env.video_id, "question": "哪里总结的"}).get_json()
    assert r["success"] and "00:30" in r["answer"] and r["tools_used"] == ["search_transcript"]

    assert c.post("/chat", json={"video_id": env.video_id}).get_json()["success"] is False
    assert c.post("/analyze", json={"filepath": "nope.mp4"}).get_json()["success"] is False
    assert c.get("/tasks/xxx").status_code == 404


# ------------------------------------------------------------------ 供应商配置
def test_provider_autodetect(monkeypatch):
    for k in ("LLM_PROVIDER", "DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    assert config._detect_provider() == "dashscope"          # 默认保持原行为
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")
    assert config._detect_provider() == "deepseek"           # 只配了 DeepSeek key
    monkeypatch.setenv("DASHSCOPE_API_KEY", "y")
    assert config._detect_provider() == "dashscope"          # 两个都有时需显式指定
    monkeypatch.setenv("LLM_PROVIDER", "deepseek")
    assert config._detect_provider() == "deepseek"


def test_deepseek_preset_is_single_model_with_thinking_disabled():
    p = config.PROVIDERS["deepseek"]
    assert p["agent"] == p["text"] == p["vision"] == "deepseek-flash"
    assert p["extra_body"] == {"thinking": {"type": "disabled"}}
    assert p["base_url"] == "https://api.deepseek.com"


# ------------------------------------------------------------------ 去重降级（无需 CLIP 模型）
def test_dedupe_falls_back_to_hash_backend(tmp_path, monkeypatch):
    pytest.importorskip("transformers")
    pytest.importorskip("sklearn")
    from PIL import Image, ImageDraw

    from app.actions import generate_ppt as gp

    monkeypatch.setenv("DEDUPE_BACKEND", "hash")
    monkeypatch.setattr(gp, "_backend", None)

    def slide(path, bg, bar_x, noise=0):
        im = Image.new("RGB", (640, 360), bg)
        ImageDraw.Draw(im).rectangle([bar_x, 100, bar_x + 200, 200], fill=(255, 255, 255))
        if noise:
            ImageDraw.Draw(im).point((5, 5), fill=(noise, noise, noise))
        im.save(path)

    slide(tmp_path / "0001.png", (30, 60, 140), 50)
    slide(tmp_path / "0002.png", (30, 60, 140), 50, noise=9)   # 与 0001 几乎相同 → 应被去重
    slide(tmp_path / "0003.png", (30, 60, 140), 380)           # 内容明显变化 → 保留
    slide(tmp_path / "0004.png", (30, 60, 140), 380, noise=7)  # 与 0003 相同 → 去重

    # 外部传入 0.9999（按 CLIP 经验给的）应被忽略，hash 后端使用自己的固定阈值
    backend = gp.generate_ppt(str(tmp_path), threshold_input=0.9999)
    kept = sorted(f for f in os.listdir(tmp_path) if f.endswith(".png"))
    assert kept == ["0001.png", "0003.png"]
    assert backend == "hash" and gp._backend == "hash"


# ------------------------------------------------------------------ 流水线模式（阶段 0）
def test_pipeline_mode_needs_no_llm_decisions_when_all_steps_succeed(env, monkeypatch):
    from app.agent import loop
    from app.agent.state import Workspace

    monkeypatch.setattr(config, "ANALYZE_MODE", "pipeline")
    client = _use_client(monkeypatch, [])  # 空脚本：只要 Agent 被调用一次就会 IndexError
    ws = Workspace(env.video_id, "http://h:5000")
    events = []
    loop.analyze_video(ws, events.append)

    assert client.i == 0
    result = json.load(open(ws.result_path, encoding="utf-8"))
    assert "流水线自动完成" in result["agent_note"]
    assert len(result["segments"]) == 3 and result["division"] and result["summary"].startswith("该视频")
    tools_run = [e["tool"] for e in events if e["type"] == "tool_start"]
    assert tools_run[0] == "get_video_info" and tools_run[-1] == "finish"
    assert {"transcribe", "correct_transcript", "analyze_structure", "extract_keyframes", "write_frame_notes"} <= set(tools_run)


def test_pipeline_hands_failures_to_agent_for_repair(env, monkeypatch):
    from app.agent import loop
    from app.agent.state import Workspace
    from app.services import llm

    monkeypatch.setattr(config, "ANALYZE_MODE", "pipeline")
    calls = {"n": 0}

    def flaky_summary(text):
        calls["n"] += 1
        if calls["n"] == 1:
            return {"summary": "无法生成视频摘要", "highlights": [], "failed": True}
        return {"summary": "该视频主要讲述了修复后的摘要", "highlights": ["a"]}

    monkeypatch.setattr(llm, "generate_summary", flaky_summary)
    client = _use_client(monkeypatch, [[("generate_summary", {})], [("finish", {"note": "已修复摘要"})]])
    ws = Workspace(env.video_id)
    events = []
    loop.analyze_video(ws, events.append)

    assert client.i == 2  # Agent 只出场修复，没有重跑其它步骤
    result = json.load(open(ws.result_path, encoding="utf-8"))
    assert result["summary"].startswith("该视频主要讲述了修复后")
    assert any(e["type"] == "thought" and "交给 Agent 修复" in e["text"] for e in events)


def test_pipeline_without_audio_skips_speech_steps(env, monkeypatch):
    from app.agent import loop
    from app.agent.state import Workspace
    from app.services import media

    monkeypatch.setattr(config, "ANALYZE_MODE", "pipeline")
    monkeypatch.setattr(media, "has_audio_stream", lambda p: False)
    _use_client(monkeypatch, [[("finish", {"note": "无语音视频，仅画面笔记"})]])  # 校验会报"无语音相关缺失"，由 Agent 收尾
    ws = Workspace(env.video_id)
    events = []
    loop.analyze_video(ws, events.append)
    tools_run = [e["tool"] for e in events if e["type"] == "tool_start"]
    assert "transcribe" not in tools_run and "extract_keyframes" in tools_run
    assert os.path.exists(ws.result_path)


def test_extract_keyframes_reports_dedupe_backend(env, monkeypatch):
    from app.agent import tools
    from app.agent.state import Workspace

    ppt = sys.modules["app.actions.generate_ppt"]
    monkeypatch.setattr(ppt, "generate_ppt", lambda folder, threshold_input: "hash")
    ws = Workspace(env.video_id)
    tools.run_tool("get_video_info", ws, {}, "analyze")
    r = tools.run_tool("extract_keyframes", ws, {"strategy": "slides"}, "analyze")
    assert r["dedupe_backend"] == "hash" and "无需重复尝试" in r["note"]

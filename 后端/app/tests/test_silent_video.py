"""无语音视频：画面笔记 → 视觉字幕 → 摘要/分段/脑图/关键词/入库 照常工作。"""
import json

from app import config
from app.agent import loop, tools
from app.agent.state import Workspace
from app.services import keywords, llm, media
from app.tests.test_agent_offline import env  # noqa: F401  复用离线环境夹具


def _silent(monkeypatch, captured):
    monkeypatch.setattr(media, "has_audio_stream", lambda p: False)
    monkeypatch.setattr(config, "ANALYZE_MODE", "pipeline")
    monkeypatch.setattr(llm, "analyze_frame", lambda path, caps, url="": (
        captured.append(caps) or {"notes": {"content": f"# 注意力矩阵图 🎯\n\n**摘要**：画面展示 Transformer 的自注意力矩阵。\n\n![画面]({url})\n\n## 要点\n- 查询与键的点积"}}))
    seen = {}
    monkeypatch.setattr(llm, "semantic_divide", lambda segs, d=0: (
        seen.setdefault("div_input", segs) and [{"title": "画面", "time_range": {"start_time": "00:00:00", "end_time": "00:00:30"},
                                                  "key_points": ["a", "b", "c"]}], []))
    monkeypatch.setattr(llm, "generate_summary", lambda t: (seen.setdefault("summary_text", t),
                                                           {"summary": "画面讲解注意力矩阵", "highlights": ["注意力"]})[1])
    monkeypatch.setattr(llm, "generate_mind_map", lambda t: {"mind_map": {"config": {}, "data": {"id": "root", "name": "根", "children": []}}})
    return seen


def test_note_to_caption_strips_markdown_and_images():
    c = tools._note_to_caption("# 标题 🎯\n\n**摘要**：内容\n\n![画面](http://x/a.png)\n\n## 要点\n- 点积")
    assert "![" not in c and "http" not in c and "#" not in c and "*" not in c
    assert c.startswith("标题") and "点积" in c


def test_silent_pipeline_builds_visual_transcript_and_all_outputs(env, monkeypatch):  # noqa: F811
    caps = []
    seen = _silent(monkeypatch, caps)
    ws = Workspace(env.video_id)
    loop.analyze_video(ws)

    tr = ws.load("transcript")
    assert tr["source"] == "visual" and len(tr["segments"]) >= 2
    assert all("![" not in s["text"] and s["end_time"] > s["start_time"] for s in tr["segments"])
    assert set(caps) == {"无语音内容"}                      # 笔记提示走"无语音"分支，且视觉字幕不会回灌
    assert seen["div_input"] and seen["summary_text"]        # 结构分析/摘要确实拿到了文本
    r = json.load(open(ws.result_path, encoding="utf-8"))
    assert r["summary"] == "画面讲解注意力矩阵" and r["division"]
    assert r["transcript_source"] == "visual"
    assert keywords.extract_keywords(tr["segments"], 5)      # 关键词可用
    from app.db import repo
    assert repo.get_transcript(env.video_id)                 # 已入库，可检索/出题


def test_visual_transcript_skipped_when_speech_exists(env, monkeypatch):  # noqa: F811
    ws = Workspace(env.video_id)
    ws.save("transcript", {"segments": [{"start_time": 0, "end_time": 5, "text": "有语音"}], "text": "有语音"})
    assert "skipped" in tools.run_tool("build_visual_transcript", ws, {}, "analyze")


def test_visual_transcript_errors_without_notes(env):  # noqa: F811
    ws = Workspace(env.video_id)
    assert "error" in tools.run_tool("build_visual_transcript", ws, {}, "analyze")

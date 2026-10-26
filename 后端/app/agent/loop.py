"""基于 DashScope(OpenAI 兼容) function calling 的 Agent 循环。"""
import json
import logging
import os
import re

from app import config
from app.agent import pipeline, prompts, tools
from app.agent.state import CourseWorkspace, Workspace
from app.services import media

log = logging.getLogger(__name__)


def _assistant_dict(msg):
    d = {"role": "assistant", "content": msg.content or ""}
    if msg.tool_calls:
        d["tool_calls"] = [
            {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
            for c in msg.tool_calls
        ]
    return d


def run_agent(group, ws: Workspace, messages, emit=lambda e: None, max_steps=None, stop_tool=None):
    """运行 Agent 循环，直到模型不再调用工具 / 调用了 stop_tool / 达到最大步数。

    messages 会被原地追加（便于聊天场景保留多轮历史）。返回最终文本回复。
    """
    max_steps = max_steps or config.AGENT_MAX_STEPS
    client = config.get_client()
    tool_schemas = tools.schemas(group)

    for step in range(1, max_steps + 1):
        completion = client.chat.completions.create(
            model=config.AGENT_MODEL, messages=messages, tools=tool_schemas, stream=False,
            extra_body=config.extra_body(),
        )
        msg = completion.choices[0].message
        messages.append(_assistant_dict(msg))
        if msg.content:
            emit({"type": "thought", "step": step, "text": msg.content})

        if not msg.tool_calls:
            return msg.content or ""

        stop = False
        for call in msg.tool_calls:
            name = call.function.name
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = None
            if args is None:
                observation = {"error": "工具参数不是合法 JSON，请重新生成"}
            else:
                emit({"type": "tool_start", "step": step, "tool": name, "args": args})
                observation = tools.run_tool(name, ws, args, group)
                emit({"type": "tool_end", "step": step, "tool": name,
                      "ok": "error" not in observation, "observation": observation})
            messages.append({
                "role": "tool", "tool_call_id": call.id,
                "content": json.dumps(observation, ensure_ascii=False),
            })
            if name == stop_tool and "error" not in observation:
                stop = True
        if stop:
            return "已完成"

    raise RuntimeError(f"Agent 超过最大步数({max_steps})仍未结束")


def analyze_video(ws: Workspace, emit=lambda e: None, mode=None):
    """一键解析。

    pipeline(默认)：确定性流水线编排全部步骤，仅当出现失败/校验问题时才交给 Agent 修复；
    agent：全程由 Agent 自主规划。无论哪种，都保证最终一定有 result 文件。
    """
    mode = mode or config.ANALYZE_MODE
    if _result_exists(ws):
        os.remove(ws.result_path)  # 重新解析：避免旧结果干扰"是否已收尾"的判断

    error = None
    try:
        if mode == "agent":
            messages = [
                {"role": "system", "content": prompts.ANALYZE_SYSTEM_PROMPT},
                {"role": "user", "content": "请解析这个视频，工具会自动使用当前视频，你不需要传 video_id。"},
            ]
            run_agent("analyze", ws, messages, emit, stop_tool="finish")
        else:
            issues = pipeline.run_pipeline(ws, emit)
            if issues:
                emit({"type": "thought", "step": 0, "text": "流水线遇到问题，交给 Agent 修复：" + "；".join(issues)})
                messages = [
                    {"role": "system", "content": prompts.ANALYZE_SYSTEM_PROMPT},
                    {"role": "user", "content": prompts.REPAIR_USER_PROMPT.format(issues="\n".join(f"- {i}" for i in issues))},
                ]
                run_agent("analyze", ws, messages, emit, max_steps=12, stop_tool="finish")
    except Exception as e:  # noqa: BLE001
        error = str(e)
        log.exception("解析异常")
        emit({"type": "error", "text": error})

    if not _result_exists(ws):
        # 兜底（流水线无问题，或 Agent 没来得及 finish）：把已有产物汇总出来
        note = "流水线自动完成。" if (mode != "agent" and not error) else f"未正常收尾，已自动汇总现有结果。{error or ''}"
        emit({"type": "tool_start", "step": 99, "tool": "finish", "args": {"note": note}})
        obs = tools.run_tool("finish", ws, {"note": note}, "analyze")
        emit({"type": "tool_end", "step": 99, "tool": "finish", "ok": "error" not in obs, "observation": obs})
    return ws.result_path


def _result_exists(ws):
    return os.path.exists(ws.result_path)


_TS_RE = re.compile(r"(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)")
NOT_MENTIONED = "视频中未提及"
CITE_TOLERANCE = 2.0  # 秒


def extract_citations(answer: str, segments):
    """抽取回答里的时间戳并用字幕核对：落在某段字幕(±2s)内才算有效，并附上该段原文。"""
    out, seen = [], set()
    for m in _TS_RE.finditer(answer or ""):
        a, b, c = m.groups()
        sec = int(a) * 3600 + int(b) * 60 + int(c) if c is not None else int(a) * 60 + int(b)
        if sec in seen:
            continue
        seen.add(sec)
        seg = (next((s for s in segments if s["start_time"] <= sec < s["end_time"]), None)
               or next((s for s in segments
                        if s["start_time"] - CITE_TOLERANCE <= sec <= s["end_time"] + CITE_TOLERANCE), None))
        out.append({"time": media.seconds_to_hhmmss(sec), "seconds": sec, "valid": seg is not None,
                    "text": seg["text"] if seg else ""})
    return out


def chat_with_video(ws: Workspace, history, question, emit=lambda e: None, client_id=None):
    """视频问答。返回 (answer, new_history, citations)。
    代码保证：答案要么带有效时间戳，要么明确“视频中未提及”；否则追问一次让模型补依据。"""
    ws.client_id = client_id
    messages = [{"role": "system", "content": prompts.CHAT_SYSTEM_PROMPT}]
    messages += [m for m in history if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)]
    messages.append({"role": "user", "content": question})
    answer = run_agent("chat", ws, messages, emit, max_steps=8)

    try:
        segments = tools._segments(ws)
    except Exception:  # noqa: BLE001
        segments = []
    citations = extract_citations(answer, segments)
    if segments and NOT_MENTIONED not in answer and not any(c["valid"] for c in citations):
        messages.append({"role": "assistant", "content": answer})
        messages.append({"role": "user", "content": (
            "你的回答缺少有效的字幕时间戳依据。请用 search_transcript / get_transcript_window 找到依据，"
            "在每条结论后标注 [mm:ss]；如果字幕确实没有依据，请直接回答“视频中未提及”。")})
        answer = run_agent("chat", ws, messages, emit, max_steps=6)
        citations = extract_citations(answer, segments)

    new_history = [m for m in history if m.get("role") in ("user", "assistant")]
    new_history += [{"role": "user", "content": question}, {"role": "assistant", "content": answer}]
    return answer, new_history, citations


# ------------------------------------------------------------------ 整门课问答
_COURSE_CITE_RE = re.compile(r"[\[【]([^\[\]【】]+?)\s+(\d{1,2}:\d{2}(?::\d{2})?)[\]】]")
COURSE_NOT_MENTIONED = "课程中未提及"


def extract_course_citations(answer: str, videos):
    """videos: [{id, title, segments}]。校验 [视频标题 mm:ss]：标题须对应课程里的视频，时间须落在其字幕内。"""
    out, seen = [], set()
    for m in _COURSE_CITE_RE.finditer(answer or ""):
        title, ts = m.group(1).strip(), m.group(2)
        parts = [int(x) for x in ts.split(":")]
        sec = parts[0] * 3600 + parts[1] * 60 + parts[2] if len(parts) == 3 else parts[0] * 60 + parts[1]
        video = next((v for v in videos if v["title"] == title), None) or \
            next((v for v in videos if title and (title in v["title"] or v["title"] in title or v["id"].startswith(title))), None)
        key = (video["id"] if video else title, sec)
        if key in seen:
            continue
        seen.add(key)
        seg = None
        if video:
            segs = video["segments"]
            seg = (next((s for s in segs if s["start_time"] <= sec < s["end_time"]), None)
                   or next((s for s in segs if s["start_time"] - CITE_TOLERANCE <= sec <= s["end_time"] + CITE_TOLERANCE), None))
        out.append({"video_id": video["id"] if video else None, "video_title": video["title"] if video else title,
                    "time": media.seconds_to_hhmmss(sec), "seconds": sec, "valid": seg is not None,
                    "text": seg["text"] if seg else ""})
    return out


def chat_with_course(course_id, history, question, emit=lambda e: None, client_id=None):
    from app.db import repo
    course = repo.get_course(course_id)
    if not course:
        raise ValueError("课程不存在")
    ws = CourseWorkspace(course_id)
    ws.client_id = client_id
    videos = [{"id": v["id"], "title": v["title"], "segments": repo.get_transcript(v["id"])} for v in course["videos"]]
    messages = [{"role": "system", "content": prompts.COURSE_CHAT_SYSTEM_PROMPT}]
    messages += [m for m in history if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)]
    messages.append({"role": "user", "content": question})
    answer = run_agent("course", ws, messages, emit, max_steps=8)
    citations = extract_course_citations(answer, videos)
    if videos and COURSE_NOT_MENTIONED not in answer and not any(c["valid"] for c in citations):
        messages.append({"role": "assistant", "content": answer})
        messages.append({"role": "user", "content": (
            "你的回答缺少有效的出处。请用 search_course / get_video_window 找到依据，在每条结论后标注 [视频标题 mm:ss]；"
            "确实没有依据就直接回答“课程中未提及”。")})
        answer = run_agent("course", ws, messages, emit, max_steps=6)
        citations = extract_course_citations(answer, videos)
    new_history = [m for m in history if m.get("role") in ("user", "assistant")]
    new_history += [{"role": "user", "content": question}, {"role": "assistant", "content": answer}]
    return answer, new_history, citations

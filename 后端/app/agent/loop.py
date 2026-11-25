"""基于 DashScope(OpenAI 兼容) function calling 的 Agent 循环。"""
import contextlib
import contextvars
import json
import logging
import os
import re

from app import config
from app.agent import pipeline, prompts, tools
from app.agent.state import CourseWorkspace, Workspace
from app.services import media

log = logging.getLogger(__name__)

# 问答循环的控制只加在 chat / course。解析仍按既定工具顺序走，允许同一工具重试。
_CHAT_GROUPS = ("chat", "course")
_TOOL_RESULTS_KEPT = 2
_TOOL_OMITTED = "[已省略较早的工具结果，需要时请换参数重新调用]"
_chat_stats = contextvars.ContextVar("chat_stats", default=None)
last_chat_stats = None


class _ChatStats:
    def __init__(self):
        self.steps = self.tool_calls = self.repeated_tool_calls = 0

    def to_dict(self):
        return {"steps": self.steps, "tool_calls": self.tool_calls,
                "repeated_tool_calls": self.repeated_tool_calls}


class AgentStepLimit(RuntimeError):
    """步数用尽。解析路径仍抛出，由 analyze_video 收尾；问答路径改成带标注的部分回答。"""

    def __init__(self, max_steps):
        self.max_steps = max_steps
        super().__init__(f"Agent 超过最大步数({max_steps})仍未结束")


def _assistant_dict(msg):
    d = {"role": "assistant", "content": msg.content or ""}
    if msg.tool_calls:
        d["tool_calls"] = [
            {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
            for c in msg.tool_calls
        ]
    return d


def _call_key(name, args):
    if not isinstance(args, dict):
        return None
    return name + "\n" + json.dumps(args, ensure_ascii=False, sort_keys=True)


def _latest_user_question(messages):
    for m in reversed(messages):
        if m.get("role") == "user" and isinstance(m.get("content"), str):
            return m["content"]
    return ""


def _compact_tool_results(messages, keep=_TOOL_RESULTS_KEPT):
    """只保留最近几条工具结果原文，更早的换成占位。工具结果可以重新调用得到。"""
    idxs = [i for i, m in enumerate(messages) if m.get("role") == "tool"]
    for i in idxs[:-keep] if keep else idxs:
        if messages[i].get("content") != _TOOL_OMITTED:
            messages[i]["content"] = _TOOL_OMITTED


def _place_question(messages, reminders, question, force=False):
    """原问题只留一份在上下文末尾，避免被工具结果淹没。上一份提醒先去掉。"""
    for m in reminders:
        if m in messages:
            messages.remove(m)
    reminders.clear()
    if not question:
        return
    if force:
        content = f"原问题：{question}\n相同工具和参数已经调用过。请根据已有结果直接回答，不要再调用工具。"
    else:
        content = f"原问题：{question}\n若已有足够依据，请直接回答；不要用相同参数重复调用工具。"
    msg = {"role": "user", "content": content}
    reminders.append(msg)
    messages.append(msg)


def _complete(client, messages, tool_schemas, with_tools):
    kwargs = {"model": config.AGENT_MODEL, "messages": messages, "stream": False, "extra_body": config.extra_body()}
    if with_tools:
        kwargs["tools"] = tool_schemas
    return client.chat.completions.create(**kwargs)


def _note_stats(steps=0, tool_calls=0, repeated=0):
    stats = _chat_stats.get()
    if stats is None:
        return
    stats.steps += steps
    stats.tool_calls += tool_calls
    stats.repeated_tool_calls += repeated


def run_agent(group, ws: Workspace, messages, emit=lambda e: None, max_steps=None, stop_tool=None):
    """运行 Agent 循环，直到模型不再调用工具 / 调用了 stop_tool / 达到最大步数。

    messages 会被原地追加（便于聊天场景保留多轮历史）。返回最终文本回复。
    问答（chat / course）额外做三件事：相同工具和参数不执行第二次，并要求直接作答；
    每一步把原问题放回末尾；只保留最近两条工具结果。
    """
    max_steps = max_steps or config.AGENT_MAX_STEPS
    client = config.get_client()
    tool_schemas = tools.schemas(group)
    guard = group in _CHAT_GROUPS
    question = _latest_user_question(messages) if guard else ""
    reminders, seen = [], set()

    def force_answer():
        _place_question(messages, reminders, question, force=True)
        completion = _complete(client, messages, tool_schemas, with_tools=False)
        _note_stats(steps=1)
        msg = completion.choices[0].message
        messages.append(_assistant_dict(msg))
        if msg.content:
            emit({"type": "thought", "step": max_steps, "text": msg.content})
        return (msg.content or "").strip()

    for step in range(1, max_steps + 1):
        if guard:
            _compact_tool_results(messages)
            if any(m.get("role") == "tool" for m in messages):
                _place_question(messages, reminders, question)
        completion = _complete(client, messages, tool_schemas, with_tools=True)
        _note_stats(steps=1)
        msg = completion.choices[0].message
        messages.append(_assistant_dict(msg))
        if msg.content:
            emit({"type": "thought", "step": step, "text": msg.content})

        if not msg.tool_calls:
            return msg.content or ""

        stop = repeated = False
        for call in msg.tool_calls:
            name = call.function.name
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = None
            key = _call_key(name, args) if guard else None
            if key and key in seen:
                repeated = True
                _note_stats(repeated=1)
                observation = {"skipped": True, "reason": "相同工具和参数已经调用过，请根据已有结果直接回答。"}
                emit({"type": "tool_start", "step": step, "tool": name, "args": args})
                emit({"type": "tool_end", "step": step, "tool": name, "ok": False, "observation": observation})
            elif args is None:
                observation = {"error": "工具参数不是合法 JSON，请重新生成"}
            else:
                if key:
                    seen.add(key)
                emit({"type": "tool_start", "step": step, "tool": name, "args": args})
                observation = tools.run_tool(name, ws, args, group)
                _note_stats(tool_calls=1)
                emit({"type": "tool_end", "step": step, "tool": name,
                      "ok": "error" not in observation, "observation": observation})
            messages.append({
                "role": "tool", "tool_call_id": call.id,
                "content": json.dumps(observation, ensure_ascii=False),
            })
            if name == stop_tool and "error" not in observation and not observation.get("skipped"):
                stop = True
        if repeated:
            text = force_answer()
            if text:
                return text
            return _partial_answer(messages, reason="相同工具和参数重复，已提前停止")
        if stop:
            return "已完成"

    raise AgentStepLimit(max_steps)


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


def extract_citations(answer: str, segments, visual=()):
    """抽取回答里的时间戳并用字幕核对：落在某段字幕(±2s)内才算有效，并附上该段原文。"""
    out, seen = [], set()
    for m in _TS_RE.finditer(answer or ""):
        a, b, c = m.groups()
        sec = int(a) * 3600 + int(b) * 60 + int(c) if c is not None else int(a) * 60 + int(b)
        is_frame = bool(re.search(r"[\[【]画面\s*$", answer[max(0, m.start()-12):m.start()]))
        key = (is_frame, sec)
        if key in seen:
            continue
        seen.add(key)
        if is_frame:
            frame = next((f for f in visual if int(f["start"]) == sec), None)
            out.append({"time": media.seconds_to_hhmmss(sec), "seconds": sec, "source": "ocr",
                        "frame": frame["frame"] if frame else "", "valid": frame is not None,
                        "text": frame["text"] if frame else ""})
            continue
        seg = (next((s for s in segments if s["start_time"] <= sec < s["end_time"]), None)
               or next((s for s in segments
                        if s["start_time"] - CITE_TOLERANCE <= sec <= s["end_time"] + CITE_TOLERANCE), None))
        out.append({"time": media.seconds_to_hhmmss(sec), "seconds": sec, "valid": seg is not None,
                    "text": seg["text"] if seg else ""})
    return out


def fit_history(history, budget=None):
    """按轮次从新到旧保留历史，直到字符预算。

    一轮从一条 user 消息起，到下一条 user 之前。最近一轮即使超预算也整段保留，不从句子中间切开。
    当前问题由调用方另附，不在这里裁。
    """
    budget = config.CHAT_HISTORY_CHAR_BUDGET if budget is None else budget
    msgs = [m for m in history or []
            if isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)]
    if not msgs:
        return []
    rounds, cur = [], []
    for m in msgs:
        if m["role"] == "user" and cur:
            rounds.append(cur)
            cur = []
        cur.append(m)
    rounds.append(cur)

    def nchars(rnd):
        return sum(len(m["content"]) for m in rnd)

    kept = [rounds[-1]]
    used = nchars(rounds[-1])
    limit = max(0, budget)
    for rnd in reversed(rounds[:-1]):
        n = nchars(rnd)
        if used + n > limit:
            break
        kept.append(rnd)
        used += n
    kept.reverse()
    return [m for rnd in kept for m in rnd]


def _partial_answer(messages, max_steps=None, reason="已达到步数上限"):
    """取最后一段助手正文；没有正文则说明停在哪个工具。"""
    last_text, last_tool = "", ""
    for m in messages:
        if m.get("role") != "assistant":
            continue
        content = m.get("content")
        if isinstance(content, str) and content.strip():
            last_text = content.strip()
        for call in m.get("tool_calls") or []:
            name = ((call.get("function") or {}).get("name")) or ""
            if name:
                last_tool = name
    if reason == "已达到步数上限":
        note = f"已达到步数上限 {max_steps}"
        stopped = f"已达到步数上限（{max_steps}）"
    else:
        note = stopped = reason
    if last_text:
        return f"{last_text}\n\n（{note}，以上内容可能不完整。）"
    if last_tool:
        return f"{stopped}，停在工具 {last_tool}，尚未形成回答。"
    return f"{stopped}，尚未形成回答。"


def _run_chat(group, ws, messages, emit, max_steps):
    try:
        return run_agent(group, ws, messages, emit, max_steps=max_steps)
    except AgentStepLimit as e:
        log.warning("问答达到步数上限: %s", e)
        return _partial_answer(messages, e.max_steps)


def _chat_messages(system, history, question):
    messages = [{"role": "system", "content": system}]
    messages += fit_history(history)
    messages.append({"role": "user", "content": question})
    return messages


@contextlib.contextmanager
def _collect_chat_stats():
    stats = _ChatStats()
    token = _chat_stats.set(stats)
    try:
        yield
    finally:
        global last_chat_stats
        last_chat_stats = stats.to_dict()
        _chat_stats.reset(token)


def chat_with_video(ws: Workspace, history, question, emit=lambda e: None, client_id=None):
    """视频问答。返回 (answer, new_history, citations)。
    代码保证：答案要么带有效时间戳，要么明确“视频中未提及”；否则追问一次让模型补依据。
    步数用尽时返回已有正文并标注，不把整次问答变成失败。"""
    with _collect_chat_stats():
        ws.client_id = client_id
        messages = _chat_messages(prompts.CHAT_SYSTEM_PROMPT, history, question)
        answer = _run_chat("chat", ws, messages, emit, max_steps=8)

        try:
            segments = tools._segments(ws)
        except Exception:  # noqa: BLE001
            segments = []
        visual = ws.load("ocr", [])
        citations = extract_citations(answer, segments, visual)
        if (segments or visual) and NOT_MENTIONED not in answer and not any(c["valid"] for c in citations):
            messages.append({"role": "assistant", "content": answer})
            messages.append({"role": "user", "content": (
                "你的回答缺少有效的字幕时间戳依据。请用 search_transcript / get_transcript_window 找到依据，"
                "在每条结论后标注 [mm:ss]；如果字幕确实没有依据，请直接回答“视频中未提及”。")})
            answer = _run_chat("chat", ws, messages, emit, max_steps=6)
            citations = extract_citations(answer, segments, visual)

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
    with _collect_chat_stats():
        messages = _chat_messages(prompts.COURSE_CHAT_SYSTEM_PROMPT, history, question)
        answer = _run_chat("course", ws, messages, emit, max_steps=8)
        citations = extract_course_citations(answer, videos)
        if videos and COURSE_NOT_MENTIONED not in answer and not any(c["valid"] for c in citations):
            messages.append({"role": "assistant", "content": answer})
            messages.append({"role": "user", "content": (
                "你的回答缺少有效的出处。请用 search_course / get_video_window 找到依据，在每条结论后标注 [视频标题 mm:ss]；"
                "确实没有依据就直接回答“课程中未提及”。")})
            answer = _run_chat("course", ws, messages, emit, max_steps=6)
            citations = extract_course_citations(answer, videos)
        new_history = [m for m in history if m.get("role") in ("user", "assistant")]
        new_history += [{"role": "user", "content": question}, {"role": "assistant", "content": answer}]
        return answer, new_history, citations

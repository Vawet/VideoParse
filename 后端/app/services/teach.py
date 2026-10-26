"""教师备课：检索课程素材 -> LLM 出大纲 -> 代码校验每个要点的证据、对齐时间预算 -> 生成幻灯片 JSON + 作业。
关键点由代码保证：①每个要点都有可核对的字幕原话 ②各环节分钟数之和严格等于目标课时。"""
import logging
from typing import List, Optional

from app import evidence as ev
from app import retrieval
from app.db import repo
from app.services import llm, media, quiz as quiz_service

log = logging.getLogger(__name__)

SYSTEM = (
    "你是资深教研老师，依据给定的课程字幕素材为老师设计一节课的教案大纲。只能使用素材里出现的内容。\n"
    "把课分成 3-6 个教学环节(sections)，每个环节有 title、minutes(整数)、points(讲解要点)。"
    "每个 point 必须有 text(要点，一句话) 以及证据：video_id、start(hh:mm:ss)、quote(素材中的**逐字原话**，≥8字)。"
    "找不到依据的要点不要写。各环节 minutes 之和应等于目标课时。以 JSON 返回："
    '{"sections":[{"title":"","minutes":10,"points":[{"text":"","video_id":"","start":"00:01:00","quote":""}]}]}'
)


def allocate_minutes(weights: List[float], total: int) -> List[int]:
    """把 total 分钟按权重分给各环节：整数、每段至少 1 分钟、总和严格等于 total（最大余数法）。"""
    n = len(weights)
    if n == 0:
        return []
    if total < n:
        raise ValueError(f"目标课时 {total} 分钟不足以安排 {n} 个环节")
    ws = [max(w, 0.01) for w in weights]
    s = sum(ws)
    spare = total - n  # 先给每段 1 分钟
    raw = [spare * w / s for w in ws]
    out = [1 + int(r) for r in raw]
    for i in sorted(range(n), key=lambda i: raw[i] - int(raw[i]), reverse=True)[:total - sum(out)]:
        out[i] += 1
    return out


def _fmt_hits(hits) -> str:
    return "\n".join(f"[video_id={h.video_id} 《{h.video_title}》 {media.seconds_to_hhmmss(h.start)}] {h.text}" for h in hits)


def _finalize_sections(raw_sections, course_segments: dict, minutes: int):
    """校验证据 + 对齐时间。返回 (sections, dropped_points, adjusted)。"""
    sections, dropped = [], 0
    for sec in raw_sections if isinstance(raw_sections, list) else []:
        if not isinstance(sec, dict) or not str(sec.get("title", "")).strip():
            continue
        points = []
        for p in sec.get("points") or []:
            if not isinstance(p, dict) or not str(p.get("text", "")).strip():
                dropped += 1
                continue
            vid = p.get("video_id")
            start = media.parse_timestamp(p.get("start"))
            good = ev.verify_evidence_list(course_segments.get(vid, []), [{
                "video_id": vid, "start": start if start >= 0 else None, "end": start if start >= 0 else None,
                "quote": str(p.get("quote", ""))}]) if vid in course_segments else []
            if not good:
                dropped += 1
                continue
            e = good[0]
            points.append({"text": str(p["text"]).strip(), "evidence": {**e, "time": media.seconds_to_hhmmss(e["start"])}})
        if points:
            try:
                w = float(sec.get("minutes") or 0)
            except (TypeError, ValueError):
                w = 0
            sections.append({"title": str(sec["title"]).strip(), "weight": w or len(points), "points": points})
    if not sections:
        return [], dropped, False
    declared = sum(s["weight"] for s in sections)
    alloc = allocate_minutes([s["weight"] for s in sections], minutes)
    for s, m in zip(sections, alloc):
        s["minutes"] = m
        del s["weight"]
    return sections, dropped, round(declared) != minutes


def build_slides(topic: str, sections: List[dict], titles: dict) -> List[dict]:
    """幻灯片 JSON 由代码从已校验的大纲生成，前端直接用 pptxgenjs 导出。"""
    slides = [{"layout": "title", "title": topic, "bullets": [f"{sum(s['minutes'] for s in sections)} 分钟 · {len(sections)} 个环节"], "notes": ""}]
    for s in sections:
        src = "；".join(f"{titles.get(p['evidence']['video_id'], '')} {p['evidence']['time']}" for p in s["points"])
        slides.append({"layout": "content", "title": f"{s['title']}（{s['minutes']} 分钟）",
                       "bullets": [p["text"] for p in s["points"]], "notes": f"素材出处：{src}"})
    slides.append({"layout": "content", "title": "小结", "bullets": [s["title"] for s in sections], "notes": ""})
    return slides


def _course_segments(course: dict) -> dict:
    return {v["id"]: repo.get_transcript(v["id"]) for v in course["videos"]}


def _homework(course_id: str, hits, course_segments: dict, topic: str, count: int, chat_json=None) -> Optional[dict]:
    """作业：在命中最多的视频上调用出题（引用校验同样适用）。"""
    if count <= 0 or not hits:
        return None
    # 命中最多的视频；平局取排名更靠前（先出现）的，保证结果确定
    best = max(dict.fromkeys(h.video_id for h in hits), key=lambda v: sum(1 for h in hits if h.video_id == v))
    res = quiz_service.generate_questions(course_segments[best], best, topic, count, chat_json=chat_json)
    if not res["questions"]:
        return {"quiz_id": None, "questions": [], "reason": res.get("reason") or "没有生成出能通过引用校验的作业题"}
    saved = repo.save_quiz(best, course_id, topic, "medium", res["questions"])
    return {"quiz_id": saved["id"], "questions": saved["questions"]}


def make_plan(course_id: str, topic: str, minutes: int = 45, homework_count: int = 3, chat_json=None) -> dict:
    chat_json = chat_json or llm.chat_json
    course = repo.get_course(course_id)
    if not course:
        raise ValueError("课程不存在")
    minutes = int(minutes)
    if minutes < 5 or minutes > 240:
        raise ValueError("课时需在 5-240 分钟之间")
    hits = retrieval.for_course(course_id).search(topic, top_k=14)
    if not hits:
        return {"ok": False, "reason": f"课程字幕中没有找到与“{topic}”相关的素材，无法备课"}
    segs = _course_segments(course)
    titles = {v["id"]: v["title"] for v in course["videos"]}

    feedback, sections, dropped = "", [], 0
    for _ in range(2):  # 一次重试：被丢弃的要点太多时把原因反馈给模型
        data = chat_json([{"role": "system", "content": SYSTEM},
                          {"role": "user", "content": f"主题：{topic}\n目标课时：{minutes} 分钟\n素材：\n{_fmt_hits(hits)}\n{feedback}"}])
        sections, dropped, adjusted = _finalize_sections(data.get("sections") if isinstance(data, dict) else [], segs, minutes)
        if sections:
            break
        feedback = "上一次的要点证据都无法在素材中核对，请只引用素材里的逐字原话和对应的 video_id/时间戳。"
    if not sections:
        return {"ok": False, "reason": "没有生成出能通过证据校验的教案大纲"}
    plan = {"ok": True, "topic": topic, "minutes": minutes, "sections": sections, "dropped_points": dropped,
            "time_adjusted": adjusted, "slides": build_slides(topic, sections, titles),
            "homework": _homework(course_id, hits, segs, topic, homework_count, chat_json)}
    saved = repo.save_teach_plan(course_id, topic, minutes, plan)
    return {**plan, "plan_id": saved["id"], "version": saved["version"]}


def revise_plan(plan_id: str, instruction: str, minutes: Optional[int] = None, chat_json=None) -> dict:
    chat_json = chat_json or llm.chat_json
    old = repo.get_teach_plan(plan_id)
    if not old:
        raise ValueError("方案不存在")
    course = repo.get_course(old["course_id"])
    segs = _course_segments(course)
    titles = {v["id"]: v["title"] for v in course["videos"]}
    minutes = int(minutes or old["minutes"])
    if minutes < 5 or minutes > 240:
        raise ValueError("课时需在 5-240 分钟之间")
    cur = [{"title": s["title"], "minutes": s["minutes"], "points": [
        {"text": p["text"], "video_id": p["evidence"]["video_id"], "start": p["evidence"]["time"], "quote": p["evidence"]["quote"]}
        for p in s["points"]]} for s in old["plan"]["sections"]]
    hits = retrieval.for_course(old["course_id"]).search(old["topic"] + " " + instruction, top_k=10)
    data = chat_json([{"role": "system", "content": SYSTEM},
                      {"role": "user", "content": (
                          f"主题：{old['topic']}\n目标课时：{minutes} 分钟\n当前大纲：{cur}\n老师的修改要求：{instruction}\n"
                          f"可用素材：\n{_fmt_hits(hits)}\n请输出修改后的完整大纲，保留未被要求改动的部分。")}])
    sections, dropped, adjusted = _finalize_sections(data.get("sections") if isinstance(data, dict) else [], segs, minutes)
    if not sections:
        return {"ok": False, "reason": "修改后的大纲没有通过证据校验，已保留原方案"}
    plan = {**old["plan"], "minutes": minutes, "sections": sections, "dropped_points": dropped,
            "time_adjusted": adjusted, "slides": build_slides(old["topic"], sections, titles)}
    saved = repo.save_teach_plan(old["course_id"], old["topic"], minutes, plan, parent_id=plan_id, instruction=instruction)
    return {**plan, "plan_id": saved["id"], "version": saved["version"], "parent_id": plan_id}

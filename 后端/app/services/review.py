"""复习规划：骨架由代码生成（日期、时长、条目、时间戳全部来自数据库），LLM 只负责每天的一句话建议。"""
import datetime as dt
import hashlib
import math
import re
from typing import List, Optional

from app.db import repo
from app.services import llm, media

MAX_DAYS = 14
_TS = re.compile(r"\d{1,2}:\d{2}")


def _item_id(*parts) -> str:
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:10]


def _titles(course: dict) -> dict:
    return {v["id"]: v["title"] for v in course["videos"]}


def _items(client_id: str, course: dict, done: set) -> List[dict]:
    """按优先级排序的待复习条目：先薄弱点（带证据时间戳），再没做过题的视频通读。"""
    titles = _titles(course)
    weak = repo.weak_topics(client_id, course_id=course["id"])
    items, covered = [], set()
    for t in weak["topics"]:
        if not t["weak"]:
            continue
        ev = t["evidence"][0] if t["evidence"] else None
        vid = ev.get("video_id") if ev else None
        start = float(ev["start"]) if ev and ev.get("start") is not None else 0.0
        end = float(ev["end"]) if ev and ev.get("end") is not None else start
        covered.add(vid)
        items.append({
            "id": _item_id("weak", t["topic"], vid, int(start)), "type": "weak", "topic": t["topic"],
            "reason": f"该知识点答对率 {int(t['accuracy'] * 100)}%（{t['wrong']}/{t['attempted']} 题错误）",
            "video_id": vid, "video_title": titles.get(vid, ""), "start": start, "end": end,
            "time": media.seconds_to_hhmmss(start), "quote": ev.get("quote", "") if ev else "",
            "minutes": max(5, min(20, math.ceil((end - start) / 60 * 2) + 5)),
        })
    for v in course["videos"]:
        if v["id"] in covered:
            continue
        mins = max(10, math.ceil((v["duration"] or 600) / 60 * 0.6))
        items.append({"id": _item_id("watch", v["id"]), "type": "watch", "topic": v["title"],
                      "reason": "课程视频通读/回看", "video_id": v["id"], "video_title": v["title"],
                      "start": 0.0, "end": float(v["duration"] or 0), "time": "00:00:00", "quote": "",
                      "minutes": min(mins, 40)})
    return [i for i in items if i["id"] not in done]


def build_plan(client_id: str, course_id: str, today: Optional[dt.date] = None,
               exam_date: Optional[dt.date] = None, daily_minutes: Optional[int] = None) -> dict:
    course = repo.get_course(course_id)
    if not course:
        raise ValueError("课程不存在")
    today = today or dt.date.today()
    profile = repo.get_profile(client_id, course_id) or {}
    if exam_date is None and profile.get("exam_date"):
        exam_date = dt.date.fromisoformat(profile["exam_date"])
    daily = int(daily_minutes or profile.get("daily_minutes") or 60)
    if exam_date is not None and exam_date < today:
        raise ValueError("考试日期已过")
    days_n = min(MAX_DAYS, (exam_date - today).days + 1) if exam_date else 7
    days_n = max(1, days_n)

    items = _items(client_id, course, set(profile.get("done_items") or []))
    days = [{"date": (today + dt.timedelta(days=i)).isoformat(), "items": [], "minutes": 0, "tip": ""}
            for i in range(days_n)]
    # 末日留给自测（天数≥2 时），其余天数按优先级顺序装填
    fill_days = days[:-1] if days_n >= 2 else days
    overflow = []
    di = 0
    for it in items:
        while di < len(fill_days) and fill_days[di]["minutes"] + it["minutes"] > daily and fill_days[di]["items"]:
            di += 1
        if di >= len(fill_days):
            overflow.append(it)
            continue
        fill_days[di]["items"].append(it)
        fill_days[di]["minutes"] += it["minutes"]
    if days_n >= 2:
        last = days[-1]
        last["items"].append({"id": _item_id("quiz", course_id), "type": "quiz", "topic": "综合自测",
                              "reason": "回顾前几天的薄弱点，对课程做一次限时自测（在问答里说“考我”即可）",
                              "video_id": None, "video_title": "", "start": 0.0, "end": 0.0, "time": "",
                              "quote": "", "minutes": min(daily, 30)})
        last["minutes"] = last["items"][0]["minutes"]
    return {"course": course["name"], "exam_date": exam_date.isoformat() if exam_date else None,
            "daily_minutes": daily, "days": days, "overflow": overflow,
            "weak_topics": [t["topic"] for t in repo.weak_topics(client_id, course_id=course_id)["topics"] if t["weak"]]}


def add_tips(plan: dict, chat_json=None) -> dict:
    """让 LLM 给每天写一句鼓励/方法建议。时间戳由代码给出，所以含时间戳的建议一律丢弃，失败也不影响计划。"""
    chat_json = chat_json or llm.chat_json
    brief = [{"day": i + 1, "topics": [it["topic"] for it in d["items"]]} for i, d in enumerate(plan["days"]) if d["items"]]
    if not brief:
        return plan
    try:
        data = chat_json([
            {"role": "system", "content": "你是学习教练。为每天的复习安排写一句不超过30字的建议，不要出现时间或时间戳。"
                                          '以 JSON 返回 {"tips":[{"day":1,"tip":"..."}]}'},
            {"role": "user", "content": str(brief)}])
        for t in data.get("tips", []):
            d = int(t.get("day", 0)) - 1
            tip = str(t.get("tip", "")).strip()
            if 0 <= d < len(plan["days"]) and tip and not _TS.search(tip):
                plan["days"][d]["tip"] = tip[:60]
    except Exception:  # noqa: BLE001
        pass
    return plan

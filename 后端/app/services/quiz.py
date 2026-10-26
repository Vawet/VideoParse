"""按需出题：检索相关字幕 -> LLM 出题(必须逐字引用字幕) -> 代码校验引用 -> 未通过的丢弃/重做。"""
import logging
from typing import List, Optional

from app import evidence as ev
from app.services import llm, media
from app.services.text import select_context

log = logging.getLogger(__name__)

QTYPES = ("single", "judge", "blank")
MAX_ROUNDS = 3  # 首轮 + 最多 2 轮补题


def _fmt_context(segments: List[dict]) -> str:
    return "\n".join(f"[{media.seconds_to_hhmmss(s['start_time'])}] {s['text']}" for s in segments)


def _normalize_question(q: dict) -> Optional[dict]:
    """结构校验与规范化；不合格返回 None。"""
    try:
        qtype = str(q.get("qtype", "")).strip().lower()
        stem = str(q.get("stem", "")).strip()
        answer = str(q.get("answer", "")).strip()
        if qtype not in QTYPES or not stem or not answer:
            return None
        options = q.get("options")
        if qtype == "single":
            if not isinstance(options, list) or len(options) < 3:
                return None
            options = [str(o).strip() for o in options]
            letter = answer[:1].upper()
            if letter not in "ABCD"[:len(options)]:
                # 答案写成了选项原文：映射回字母
                if answer in options:
                    letter = "ABCD"[options.index(answer)]
                else:
                    return None
            answer = letter
        elif qtype == "judge":
            options = None
            if answer in ("对", "正确", "true", "True", "T", "是"):
                answer = "对"
            elif answer in ("错", "错误", "false", "False", "F", "否"):
                answer = "错"
            else:
                return None
        else:
            options = None
        return {"qtype": qtype, "stem": stem, "options": options, "answer": answer,
                "explanation": str(q.get("explanation", "")).strip(),
                "topic": str(q.get("topic", "")).strip(), "raw_evidence": q.get("evidence") or []}
    except Exception:  # noqa: BLE001
        return None


def _verify_question(q: dict, video_id: str, segments: List[dict]) -> Optional[dict]:
    """校验证据：解析时间戳、逐条 verify_quote；一条都没通过则拒绝该题。"""
    candidates = []
    for e in q.pop("raw_evidence"):
        if not isinstance(e, dict):
            continue
        start = media.parse_timestamp(e.get("start"))
        candidates.append({"video_id": video_id, "start": start if start >= 0 else None,
                           "end": start if start >= 0 else None, "quote": str(e.get("quote", ""))})
    good = ev.verify_evidence_list(segments, candidates)
    if not good:
        return None
    q["evidence"] = good
    q["verified"] = True
    return q


SYSTEM = (
    "你是严谨的教学出题老师。只能依据给定的视频字幕出题，禁止使用字幕以外的知识。\n"
    "每道题必须附 evidence：start(字幕中的时间戳 hh:mm:ss) 和 quote(从字幕中**逐字摘录**的一句原话，≥8个字，"
    "且足以支撑答案)。无法从字幕中找到依据的题不要出。\n"
    "题型 qtype 只能是 single(单选，4个选项 options，answer 为 A/B/C/D)、judge(判断，answer 为 对/错)、"
    "blank(填空，stem 里用____表示空，answer 为应填内容)。每题标注考查的知识点 topic。以 JSON 返回。"
)


def generate_questions(segments: List[dict], video_id: str, topic: str = "", count: int = 5,
                       difficulty: str = "medium", qtypes=QTYPES, chat_json=None) -> dict:
    """返回 {"questions": [...已校验...], "rejected": n, "rounds": n, "reason": 可选}。"""
    chat_json = chat_json or llm.chat_json
    context = select_context(segments, topic)
    if not context:
        return {"questions": [], "rejected": 0, "rounds": 0,
                "reason": f"字幕中没有找到与“{topic}”相关的内容，无法依据视频出题" if topic else "没有字幕可供出题"}

    accepted, rejected_total, feedback = [], 0, ""
    rounds = 0
    for _ in range(MAX_ROUNDS):
        need = count - len(accepted)
        if need <= 0:
            break
        rounds += 1
        taken = "；".join(q["stem"][:30] for q in accepted) or "无"
        user = (
            f"字幕：\n{_fmt_context(context)}\n\n请出 {need} 道题，难度 {difficulty}，题型可混合：{','.join(qtypes)}。"
            f"{'主题：' + topic + '。' if topic else ''}已出过的题（不要重复）：{taken}。{feedback}\n"
            '返回格式：{"questions":[{"qtype":"single","stem":"","options":["","","",""],"answer":"A","explanation":"",'
            '"topic":"","evidence":[{"start":"00:00:10","quote":"字幕原话"}]}]}'
        )
        try:
            data = chat_json([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}])
        except Exception as e:  # noqa: BLE001
            log.error("出题调用失败: %s", e)
            break
        round_rejected = 0
        for raw in data.get("questions", []) if isinstance(data, dict) else []:
            q = _normalize_question(raw) if isinstance(raw, dict) else None
            q = _verify_question(q, video_id, segments) if q else None
            if q and len(accepted) < count:
                q["difficulty"] = difficulty
                accepted.append(q)
            elif not q:
                round_rejected += 1
        rejected_total += round_rejected
        feedback = (f"上一轮有 {round_rejected} 道题因引用不是字幕原话或格式错误被拒，请务必逐字摘录字幕原话。"
                    if round_rejected else "")
    return {"questions": accepted, "rejected": rejected_total, "rounds": rounds}


# ------------------------------------------------------------------ 核对
JUDGE_SYSTEM = (
    "你是严谨的事实核对员。只依据给定字幕判断“待核对陈述”：supported(字幕明确支持)、contradicted(字幕明确与之矛盾)、"
    "not_found(字幕没有涉及)。supported/contradicted 必须给出字幕里的**逐字原话** quote 和其时间戳 start(hh:mm:ss)。以 JSON 返回。"
)


def verify_claim(segments: List[dict], video_id: str, claim: str, chat_json=None) -> dict:
    chat_json = chat_json or llm.chat_json
    context = select_context(segments, claim, max_chars=6000)
    if not context:
        return {"verdict": "not_found", "reason": "字幕中没有与该陈述相关的内容"}
    data = chat_json([
        {"role": "system", "content": JUDGE_SYSTEM},
        {"role": "user", "content": (
            f"字幕：\n{_fmt_context(context)}\n\n待核对陈述：{claim}\n"
            '返回：{"verdict":"supported|contradicted|not_found","start":"hh:mm:ss","quote":"字幕原话","reason":"一句话理由"}')},
    ])
    verdict = data.get("verdict", "not_found")
    if verdict not in ("supported", "contradicted"):
        return {"verdict": "not_found", "reason": data.get("reason", "字幕未涉及")}
    start = media.parse_timestamp(data.get("start"))
    good = ev.verify_evidence_list(segments, [{"video_id": video_id, "start": start if start >= 0 else None,
                                              "end": start, "quote": str(data.get("quote", ""))}])
    if not good:  # 模型给了结论却给不出真实引用：降级，不让无依据的结论通过
        return {"verdict": "not_found", "reason": "模型的结论没有可验证的字幕依据，已降级为未找到"}
    return {"verdict": verdict, "reason": data.get("reason", ""), "evidence": good[0]}


# ------------------------------------------------------------------ 判分
_TRUE = {"对", "正确", "true", "t", "是", "√"}
_FALSE = {"错", "错误", "false", "f", "否", "×"}


def grade_answer(question: dict, given: str) -> bool:
    given = (given or "").strip()
    if not given:
        return False
    qtype, answer = question["qtype"], question["answer"]
    if qtype == "single":
        return given[:1].upper() == answer.upper()
    if qtype == "judge":
        g = given.lower()
        return (g in _TRUE and answer == "对") or (g in _FALSE and answer == "错")
    g, a = ev.normalize(given), ev.normalize(answer)
    return bool(g) and (g == a or (len(g) >= 2 and (g in a or a in g)))

"""Learning operations shared by the Spring tool pool and the local Flask adapter."""
import datetime as dt
import logging
from app.agent import loop, tools
from app.agent.state import Workspace
from app.db import repo
from app.services import grounded, web_search
from app.services import keywords as keywords_service
from app.services import quiz as quiz_service
from app.services import review as review_service
from app.services import teach as teach_service

log = logging.getLogger(__name__)


def _fail(message, status=200):
    return {"success": False, "error": message}, status


def _ok(payload):
    return payload, 200


def get_keywords(params, base, video_id):
    """从字幕里提取关键词（TF-IDF），附出现时间点。"""
    try:
        Workspace(video_id, base)
    except ValueError as e:
        return _fail(str(e), 400)
    top = max(1, min(int(params.get("top", 12) or 12), 50))
    kws = keywords_service.extract_keywords(repo.get_transcript(video_id), top)
    return _ok({"success": True, "keywords": kws})


def chat(params, base, *, session_token=None):
    data = params
    question = (data.get("question") or "").strip()
    course_id = data.get("course_id")
    if not question or not (course_id or data.get("video_id")):
        return _fail("缺少 video_id/course_id 或 question")
    if web_search.needs_web(question):
        return web_search.web_reply(question, data.get("history") or [])
    steps = []
    emit = lambda e: steps.append(e) if e["type"] in ("tool_start",) else None  # noqa: E731
    try:
        if course_id:
            answer, history, citations = loop.chat_with_course(course_id, data.get("history") or [], question, emit=emit,
                                                                client_id=data.get("client_id"))
        else:
            try:
                ws = Workspace(data["video_id"], base)
            except ValueError as e:
                return _fail(str(e))
            ws.platform_session_token = session_token
            if not ws.video_path:
                return _fail("视频文件不存在")
            answer, history, citations = loop.chat_with_video(ws, data.get("history") or [], question, emit=emit,
                                                              client_id=data.get("client_id"))
    except ValueError as e:
        return _fail(str(e), 404)
    except Exception as e:  # noqa: BLE001
        log.exception("问答失败")
        return _fail(f"问答失败: {e}")
    return _ok({"success": True, "source": "course" if course_id else "video", "answer": answer, "history": history, "citations": citations,
                    "tools_used": [s["tool"] for s in steps]})


def search_if_requested(params, base):
    question = params["question"]
    if web_search.needs_web(question):
        return web_search.web_reply(question)
    return _ok({"success": True, "source": "local"})


def document_route(params, base):
    question = params["question"]
    return _ok({"success": True, "web": web_search.needs_web(question),
                "strict": bool(web_search.LOCAL_ONLY.search(question))})


def document_web_sources(params, base):
    try:
        sources = web_search.search(params["question"])
    except (web_search.requests.RequestException, ValueError, KeyError, TypeError):
        return _fail("联网搜索暂时不可用，请稍后重试。", 503)
    return _ok({"success": True, "sources": sources})


def document_answer(params, base):
    result = grounded.compose(params["question"], params["excerpts"], params.get("history"),
                              params.get("allow_explanation", False))
    return _ok({"success": True, **result})


def review_weak(params, base):
    cid = params.get("client_id")
    if not cid:
        return _fail("缺少 client_id")
    out = repo.weak_topics(cid, course_id=params.get("course_id"), video_id=params.get("video_id"))
    return _ok({"success": True, **out})


def review_plan(params, base):
    data = params
    if not data.get("client_id") or not data.get("course_id"):
        return _fail("缺少 client_id 或 course_id")
    try:
        exam = dt.date.fromisoformat(data["exam_date"]) if data.get("exam_date") else None
        minutes = int(data["daily_minutes"]) if data.get("daily_minutes") else None
    except (ValueError, TypeError):
        return _fail("exam_date 需为 YYYY-MM-DD，daily_minutes 需为整数")
    try:
        repo.upsert_profile(data["client_id"], data["course_id"], exam, minutes)
        plan = review_service.build_plan(data["client_id"], data["course_id"], exam_date=exam, daily_minutes=minutes)
    except ValueError as e:
        return _fail(str(e), 404 if "课程" in str(e) else 200)
    if data.get("use_llm", True):
        plan = review_service.add_tips(plan)
    return _ok({"success": True, "plan": plan})


def review_done(params, base):
    data = params
    if not (data.get("client_id") and data.get("course_id") and data.get("item_id")):
        return _fail("缺少 client_id / course_id / item_id")
    repo.set_item_done(data["client_id"], data["course_id"], data["item_id"], bool(data.get("done", True)))
    return _ok({"success": True})


def teach_plan(params, base):
    data = params
    if not data.get("course_id") or not (data.get("topic") or "").strip():
        return _fail("缺少 course_id 或 topic")
    try:
        out = teach_service.make_plan(data["course_id"], data["topic"].strip(), data.get("minutes", 45),
                                      int(data.get("homework_count", 3)))
    except ValueError as e:
        return _fail(str(e), 404 if "课程" in str(e) else 200)
    except Exception as e:  # noqa: BLE001
        log.exception("备课失败")
        return _fail(f"备课失败: {e}")
    if not out.get("ok"):
        return _ok({"success": False, "error": out["reason"]})
    return _ok({"success": True, "plan": out})


def teach_plan_get(params, base, plan_id):
    row = repo.get_teach_plan(plan_id)
    if not row:
        return _fail("方案不存在", 404)
    return _ok({"success": True, **row, "history": repo.teach_plan_history(plan_id)})


def teach_plan_revise(params, base, plan_id):
    data = params
    if not (data.get("instruction") or "").strip():
        return _fail("缺少修改要求 instruction")
    try:
        out = teach_service.revise_plan(plan_id, data["instruction"].strip(), data.get("minutes"))
    except ValueError as e:
        return _fail(str(e), 404 if "方案" in str(e) else 200)
    except Exception as e:  # noqa: BLE001
        log.exception("修改方案失败")
        return _fail(f"修改失败: {e}")
    if not out.get("ok"):
        return _ok({"success": False, "error": out["reason"]})
    return _ok({"success": True, "plan": out})


def _workspace_from(data, base):
    if not data.get("video_id"):
        return None, "缺少 video_id"
    try:
        ws = Workspace(data["video_id"], base)
    except ValueError as e:
        return None, str(e)
    return ws, None


def _public_question(q):
    """出题接口默认不泄露答案和解析，答题后再返回。"""
    return {k: v for k, v in q.items() if k not in ("answer", "explanation")}


def quiz_generate(params, base):
    data = params
    ws, err = _workspace_from(data, base)
    if err:
        return _fail(err)
    out = tools.run_tool("generate_quiz", ws, {
        "topic": data.get("topic", ""), "count": data.get("count", 5),
        "difficulty": data.get("difficulty", "medium")}, "chat", max_chars=10 ** 6)
    if "error" in out:
        return _fail(out["error"])
    if not out.get("questions"):
        return _ok({"success": True, "quiz_id": None, "questions": [], "reason": out.get("reason", "")})
    return _ok({"success": True, "quiz_id": out["quiz_id"], "accepted": out["accepted"],
                    "rejected_by_verification": out["rejected_by_verification"],
                    "questions": [_public_question(q) for q in out["questions"]]})


def quiz_get(params, base, quiz_id):
    quiz = repo.get_quiz(quiz_id, with_answer=False)
    return _ok({"success": True, "quiz": quiz}) if quiz else _fail("题目不存在", 404)


def quiz_answer(params, base, quiz_id):
    data = params
    quiz = repo.get_quiz(quiz_id, with_answer=True)
    if not quiz:
        return _fail("题目不存在", 404)
    q = next((x for x in quiz["questions"] if x["id"] == data.get("question_id")), None)
    if not q:
        return _fail("该题不属于这套题", 404)
    correct = quiz_service.grade_answer(q, data.get("answer", ""))
    repo.record_attempt(data.get("client_id") or "anonymous", q["id"], str(data.get("answer", "")), correct)
    return _ok({"success": True, "correct": correct, "answer": q["answer"],
                    "explanation": q["explanation"], "evidence": q["evidence"]})


def verify(params, base):
    data = params
    ws, err = _workspace_from(data, base)
    if err:
        return _fail(err)
    if not data.get("claim"):
        return _fail("缺少 claim")
    out = tools.run_tool("verify_claim", ws, {"claim": data["claim"],
                                              "check_visual": bool(data.get("check_visual"))}, "chat")
    if "error" in out:
        return _fail(out["error"])
    return _ok({"success": True, **out})

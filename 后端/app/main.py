"""Flask 路由层。业务逻辑见 app/agent、app/services。

接口：
  POST /upload                  上传视频
  POST /analyze                 解析视频。默认同步返回（兼容旧前端）；body 带 {"async": true} 则立即返回 task_id
  POST /analyze/start           等价于 async=true
  GET  /tasks/<id>              任务状态
  GET  /tasks/<id>/events       SSE：Agent 每一步（思考/工具调用/结果）
  GET  /result/<video_id>       读取已保存的解析结果
  POST /chat                    视频问答 {video_id, question, history}
  GET  /frames/<video_id>[/<f>] 帧图片
"""
import io
import json
import datetime as dt
import os
import uuid

from flask import Flask, Response, jsonify, make_response, request, send_from_directory
from flask_cors import CORS

from app import config, tasks
from app.agent import loop, tools
from app.agent.state import Workspace
from app.db import repo
from app.services import quiz as quiz_service
from app.services import review as review_service
from app.services import teach as teach_service

app = Flask(__name__)
CORS(app)
app.config["UPLOAD_FOLDER"] = config.UPLOAD_FOLDER
app.config["FRAMES_FOLDER"] = config.FRAMES_FOLDER
app.config["AUDIO_FOLDER"] = config.AUDIO_FOLDER
app.config["OUTPUT_FOLDER"] = config.OUTPUT_FOLDER
app.config["MAX_CONTENT_LENGTH"] = config.MAX_CONTENT_LENGTH


def _base_url():
    return request.host_url.rstrip("/")


def _fail(msg, code=200):
    return jsonify({"success": False, "error": msg}), code


# ------------------------------------------------------------------ 上传
@app.route("/upload", methods=["POST"])
def upload_file():
    if "video" not in request.files:
        return _fail("未找到视频文件")
    file = request.files["video"]
    if file.filename == "":
        return _fail("未选择视频文件")
    if not config.allowed_file(file.filename):
        return _fail("不支持的文件格式")

    video_id = str(uuid.uuid4())
    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = f"{video_id}.{ext}"
    file.save(os.path.join(config.UPLOAD_FOLDER, filename))
    try:
        repo.register_video(video_id, title=os.path.splitext(file.filename)[0][:200])
    except Exception:  # noqa: BLE001
        app.logger.exception("登记视频失败（不影响上传）")
    return jsonify({"success": True, "filepath": filename, "video_id": video_id})


# ------------------------------------------------------------------ 解析
def _resolve_video(data):
    """从请求里得到 (Workspace, error)。video_id 缺省时取 filepath 的文件名主干。"""
    if not data or "filepath" not in data:
        return None, "缺少视频路径参数"
    filename = os.path.basename(data["filepath"])
    video_id = data.get("video_id") or os.path.splitext(filename)[0]
    try:
        ws = Workspace(video_id, _base_url())
    except ValueError as e:
        return None, str(e)
    if not ws.video_path:
        return None, "视频文件不存在"
    return ws, None


def _start_analyze(ws):
    running = tasks.find_running(ws.video_id)
    if running:
        return running  # 同一个视频不重复启动
    return tasks.start_task(ws.video_id, lambda emit: loop.analyze_video(ws, emit))


@app.route("/analyze", methods=["POST"])
def analyze_video():
    data = request.get_json(silent=True)
    ws, err = _resolve_video(data)
    if err:
        return _fail(err)

    task = _start_analyze(ws)
    if data.get("async"):
        return jsonify({"success": True, "task_id": task.id, "video_id": ws.video_id})

    # 同步模式：等待任务结束（兼容旧前端）
    for _ in tasks.sse_stream(task):
        pass
    if task.status == "error":
        return _fail(f"视频分析失败: {task.error}")
    return _result_response(ws)


@app.route("/analyze/start", methods=["POST"])
def analyze_start():
    data = request.get_json(silent=True)
    ws, err = _resolve_video(data)
    if err:
        return _fail(err)
    task = _start_analyze(ws)
    return jsonify({"success": True, "task_id": task.id, "video_id": ws.video_id})


def _result_response(ws):
    if not os.path.exists(ws.result_path):
        return _fail("解析结果不存在")
    with open(ws.result_path, encoding="utf-8") as f:
        result = json.load(f)
    return jsonify({"success": True, "result": result, "video_id": ws.video_id})


@app.route("/tasks/<task_id>", methods=["GET"])
def task_status(task_id):
    task = tasks.get_task(task_id)
    if not task:
        return _fail("任务不存在", 404)
    return jsonify({"success": True, "status": task.status, "error": task.error,
                    "video_id": task.video_id, "events": len(task.events)})


@app.route("/tasks/<task_id>/events", methods=["GET"])
def task_events(task_id):
    task = tasks.get_task(task_id)
    if not task:
        return _fail("任务不存在", 404)
    return Response(
        tasks.sse_stream(task),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/result/<video_id>", methods=["GET"])
def get_result(video_id):
    try:
        ws = Workspace(video_id, _base_url())
    except ValueError as e:
        return _fail(str(e), 400)
    return _result_response(ws)


# ------------------------------------------------------------------ 问答
@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    question = (data.get("question") or "").strip()
    course_id = data.get("course_id")
    if not question or not (course_id or data.get("video_id")):
        return _fail("缺少 video_id/course_id 或 question")
    steps = []
    emit = lambda e: steps.append(e) if e["type"] in ("tool_start",) else None  # noqa: E731
    try:
        if course_id:
            answer, history, citations = loop.chat_with_course(course_id, data.get("history") or [], question, emit=emit,
                                                                client_id=data.get("client_id"))
        else:
            try:
                ws = Workspace(data["video_id"], _base_url())
            except ValueError as e:
                return _fail(str(e))
            if not ws.video_path:
                return _fail("视频文件不存在")
            answer, history, citations = loop.chat_with_video(ws, data.get("history") or [], question, emit=emit,
                                                              client_id=data.get("client_id"))
    except ValueError as e:
        return _fail(str(e), 404)
    except Exception as e:  # noqa: BLE001
        app.logger.exception("问答失败")
        return _fail(f"问答失败: {e}")
    return jsonify({"success": True, "answer": answer, "history": history, "citations": citations,
                    "tools_used": [s["tool"] for s in steps]})


# ------------------------------------------------------------------ 课程
@app.route("/courses", methods=["GET"])
def courses_list():
    return jsonify({"success": True, "courses": repo.list_courses()})


@app.route("/courses", methods=["POST"])
def courses_create():
    name = ((request.get_json(silent=True) or {}).get("name") or "").strip()
    if not name:
        return _fail("缺少课程名称")
    return jsonify({"success": True, "course": repo.create_course(name)})


@app.route("/courses/<course_id>", methods=["GET"])
def courses_get(course_id):
    course = repo.get_course(course_id)
    return jsonify({"success": True, "course": course}) if course else _fail("课程不存在", 404)


@app.route("/courses/<course_id>/videos", methods=["POST"])
def courses_add_video(course_id):
    video_id = (request.get_json(silent=True) or {}).get("video_id")
    if not repo.get_course(course_id):
        return _fail("课程不存在", 404)
    if not video_id or not repo.get_video(video_id):
        return _fail("视频不存在，请先上传", 404)
    repo.add_video_to_course(course_id, video_id)
    return jsonify({"success": True, "course": repo.get_course(course_id)})


# ------------------------------------------------------------------ 复习
@app.route("/review/weak", methods=["GET"])
def review_weak():
    cid = request.args.get("client_id")
    if not cid:
        return _fail("缺少 client_id")
    out = repo.weak_topics(cid, course_id=request.args.get("course_id"), video_id=request.args.get("video_id"))
    return jsonify({"success": True, **out})


@app.route("/review/plan", methods=["POST"])
def review_plan():
    data = request.get_json(silent=True) or {}
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
    return jsonify({"success": True, "plan": plan})


@app.route("/review/done", methods=["POST"])
def review_done():
    data = request.get_json(silent=True) or {}
    if not (data.get("client_id") and data.get("course_id") and data.get("item_id")):
        return _fail("缺少 client_id / course_id / item_id")
    repo.set_item_done(data["client_id"], data["course_id"], data["item_id"], bool(data.get("done", True)))
    return jsonify({"success": True})


# ------------------------------------------------------------------ 教师备课
@app.route("/teach/plan", methods=["POST"])
def teach_plan():
    data = request.get_json(silent=True) or {}
    if not data.get("course_id") or not (data.get("topic") or "").strip():
        return _fail("缺少 course_id 或 topic")
    try:
        out = teach_service.make_plan(data["course_id"], data["topic"].strip(), data.get("minutes", 45),
                                      int(data.get("homework_count", 3)))
    except ValueError as e:
        return _fail(str(e), 404 if "课程" in str(e) else 200)
    except Exception as e:  # noqa: BLE001
        app.logger.exception("备课失败")
        return _fail(f"备课失败: {e}")
    if not out.get("ok"):
        return jsonify({"success": False, "error": out["reason"]})
    return jsonify({"success": True, "plan": out})


@app.route("/teach/plan/<plan_id>", methods=["GET"])
def teach_plan_get(plan_id):
    row = repo.get_teach_plan(plan_id)
    if not row:
        return _fail("方案不存在", 404)
    return jsonify({"success": True, **row, "history": repo.teach_plan_history(plan_id)})


@app.route("/teach/plan/<plan_id>/revise", methods=["POST"])
def teach_plan_revise(plan_id):
    data = request.get_json(silent=True) or {}
    if not (data.get("instruction") or "").strip():
        return _fail("缺少修改要求 instruction")
    try:
        out = teach_service.revise_plan(plan_id, data["instruction"].strip(), data.get("minutes"))
    except ValueError as e:
        return _fail(str(e), 404 if "方案" in str(e) else 200)
    except Exception as e:  # noqa: BLE001
        app.logger.exception("修改方案失败")
        return _fail(f"修改失败: {e}")
    if not out.get("ok"):
        return jsonify({"success": False, "error": out["reason"]})
    return jsonify({"success": True, "plan": out})


# ------------------------------------------------------------------ 出题 / 核对
def _workspace_from(data):
    if not data.get("video_id"):
        return None, "缺少 video_id"
    try:
        ws = Workspace(data["video_id"], _base_url())
    except ValueError as e:
        return None, str(e)
    return ws, None


def _public_question(q):
    """出题接口默认不泄露答案和解析，答题后再返回。"""
    return {k: v for k, v in q.items() if k not in ("answer", "explanation")}


@app.route("/quiz/generate", methods=["POST"])
def quiz_generate():
    data = request.get_json(silent=True) or {}
    ws, err = _workspace_from(data)
    if err:
        return _fail(err)
    out = tools.run_tool("generate_quiz", ws, {
        "topic": data.get("topic", ""), "count": data.get("count", 5),
        "difficulty": data.get("difficulty", "medium")}, "chat", max_chars=10 ** 6)
    if "error" in out:
        return _fail(out["error"])
    if not out.get("questions"):
        return jsonify({"success": True, "quiz_id": None, "questions": [], "reason": out.get("reason", "")})
    return jsonify({"success": True, "quiz_id": out["quiz_id"], "accepted": out["accepted"],
                    "rejected_by_verification": out["rejected_by_verification"],
                    "questions": [_public_question(q) for q in out["questions"]]})


@app.route("/quiz/<quiz_id>", methods=["GET"])
def quiz_get(quiz_id):
    quiz = repo.get_quiz(quiz_id, with_answer=False)
    return jsonify({"success": True, "quiz": quiz}) if quiz else _fail("题目不存在", 404)


@app.route("/quiz/<quiz_id>/answer", methods=["POST"])
def quiz_answer(quiz_id):
    data = request.get_json(silent=True) or {}
    quiz = repo.get_quiz(quiz_id, with_answer=True)
    if not quiz:
        return _fail("题目不存在", 404)
    q = next((x for x in quiz["questions"] if x["id"] == data.get("question_id")), None)
    if not q:
        return _fail("该题不属于这套题", 404)
    correct = quiz_service.grade_answer(q, data.get("answer", ""))
    repo.record_attempt(data.get("client_id") or "anonymous", q["id"], str(data.get("answer", "")), correct)
    return jsonify({"success": True, "correct": correct, "answer": q["answer"],
                    "explanation": q["explanation"], "evidence": q["evidence"]})


@app.route("/verify", methods=["POST"])
def verify():
    data = request.get_json(silent=True) or {}
    ws, err = _workspace_from(data)
    if err:
        return _fail(err)
    if not data.get("claim"):
        return _fail("缺少 claim")
    out = tools.run_tool("verify_claim", ws, {"claim": data["claim"],
                                              "check_visual": bool(data.get("check_visual"))}, "chat")
    if "error" in out:
        return _fail(out["error"])
    return jsonify({"success": True, **out})


# ------------------------------------------------------------------ 静态资源
@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(config.UPLOAD_FOLDER, filename)


@app.route("/frames/<video_id>", methods=["GET"])
def get_PPT(video_id):
    frame_folder = os.path.join(config.FRAMES_FOLDER, os.path.basename(video_id))
    if not os.path.isdir(frame_folder):
        return jsonify({"success": True, "ppt": [], "heavy": []})
    ppt, heavy = [], []
    for file in sorted(os.listdir(frame_folder)):
        if not file.endswith(".png") or file.startswith("cap_"):
            continue
        (heavy if file.startswith("heavy") else ppt).append(f"/frames/{video_id}/{file}")
    return jsonify({"success": True, "ppt": ppt, "heavy": heavy})


def generate_error_image(message):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (400, 200), color=(240, 240, 240))
    ImageDraw.Draw(img).text((20, 80), message, fill=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    resp = make_response(buf.getvalue())
    resp.headers["Content-Type"] = "image/png"
    return resp


@app.route("/frames/<video_id>/<filename>", methods=["GET"])
def get_frame_image(video_id, filename):
    frame_folder = os.path.join(config.FRAMES_FOLDER, os.path.basename(video_id))
    if not os.path.exists(frame_folder):
        return _fail("视频帧文件夹不存在", 404)
    if not filename.endswith(".png"):
        return _fail("只支持PNG格式图片", 400)
    try:
        return send_from_directory(frame_folder, filename, mimetype="image/png")
    except Exception:  # noqa: BLE001
        return generate_error_image("图片文件不存在"), 404


if __name__ == "__main__":
    # use_reloader=False：避免代码热重载杀掉正在后台运行的 Agent 任务
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False, threaded=True)

"""Agent 工具注册表。

约定：
- 每个工具签名 fn(ws: Workspace, **args) -> dict，返回给 LLM 的只是"摘要"，大数据存在 ws 里。
- 失败返回 {"error": "..."}（或抛异常，由 run_tool 统一转成 error），让 Agent 自己决定重试/换路。
- groups 决定工具属于哪个 Agent："analyze"（一键解析）、"chat"（视频问答）。
"""
import json
import logging
import os
import re
import shutil
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from app.agent.state import Workspace
from app.services import llm, media, quiz as quiz_service
from app.services.text import tokens as _tokens_set

log = logging.getLogger(__name__)

TOOLS = {}
MAX_TEXT_FOR_LLM = 30000  # 喂给单次 LLM 调用的全文字符上限


def tool(name, description, properties=None, required=None, groups=("analyze",)):
    def deco(fn):
        TOOLS[name] = {
            "fn": fn,
            "groups": groups,
            "schema": {
                "type": "function",
                "function": {
                    "name": name,
                    "description": description,
                    "parameters": {
                        "type": "object",
                        "properties": properties or {},
                        "required": required or [],
                    },
                },
            },
        }
        return fn
    return deco


def schemas(group):
    return [t["schema"] for t in TOOLS.values() if group in t["groups"]]


def run_tool(name, ws: Workspace, args: dict, group: str, max_chars=3000):
    spec = TOOLS.get(name)
    if not spec or group not in spec["groups"]:
        return {"error": f"未知工具: {name}"}
    required = spec["schema"]["function"]["parameters"]["required"]
    missing = [r for r in required if r not in args]
    if missing:
        return {"error": f"缺少必填参数: {missing}"}
    try:
        result = spec["fn"](ws, **args)
    except TypeError as e:
        result = {"error": f"参数错误: {e}"}
    except Exception as e:  # noqa: BLE001
        log.exception("工具 %s 执行失败", name)
        result = {"error": f"{type(e).__name__}: {e}"}
    text = json.dumps(result, ensure_ascii=False)
    if len(text) > max_chars:  # 防止工具输出撑爆上下文
        result = {"truncated": True, "preview": text[:max_chars]}
    return result


# ---------------------------------------------------------------- 内部辅助
def _transcript(ws):
    return ws.load("transcript", {"segments": [], "text": ""})


def _frame_files(ws):
    return media.get_sorted_image_files(ws.frames_dir) if os.path.isdir(ws.frames_dir) else []


def _default_interval(duration):
    if duration < 60:
        return 2
    if duration < 300:
        return 3
    if duration < 1800:
        return 5
    return 10


def _safe_frame_path(ws, name):
    base = os.path.basename(name)
    if not base.lower().endswith((".png", ".jpg", ".jpeg")):
        base += ".png"
    path = os.path.join(ws.frames_dir, base)
    return path if os.path.exists(path) else None


def _subsample(items, k):
    if k <= 0 or len(items) <= k:
        return items
    step = len(items) / k
    return [items[int(i * step)] for i in range(k)]


# ================================================================ 分析工具
@tool("get_video_info", "获取视频时长、是否有音轨。流程的第一步。")
def get_video_info(ws):
    path = ws.video_path
    if not path:
        return {"error": f"找不到 video_id={ws.video_id} 对应的视频文件"}
    duration = media.get_video_duration(path)
    has_audio = media.has_audio_stream(path)
    ws.update_meta(duration=duration, has_audio=has_audio)
    return {"duration_seconds": round(duration, 1), "duration": media.seconds_to_hhmmss(duration),
            "has_audio": has_audio, "size_mb": round(os.path.getsize(path) / 1024 / 1024, 2)}


@tool("transcribe", "提取音频并用 Whisper 语音识别，得到带时间戳的字幕。耗时较长。")
def transcribe(ws):
    path = ws.video_path
    if not path:
        return {"error": "视频文件不存在"}
    if not media.has_audio_stream(path):
        ws.save("transcript", {"segments": [], "text": ""})
        ws.update_meta(has_audio=False)
        return {"segments": 0, "chars": 0, "warning": "视频没有音轨，无法语音识别，请改为依赖画面分析"}
    audio = media.extract_audio_from_video(path, ws.video_id)
    if not audio:
        return {"error": "音频提取失败（可能没有音轨或 ffmpeg 未安装）"}
    from app.services.asr import speech_to_text
    segments, text = speech_to_text(audio)
    ws.save("transcript", {"segments": segments, "text": text})
    ws.save("transcript_raw", {"segments": segments, "text": text})
    if not segments:
        return {"segments": 0, "chars": 0, "warning": "没有识别到语音，请改为依赖画面分析"}
    return {"segments": len(segments), "chars": len(text), "last_end": media.seconds_to_hhmmss(segments[-1]["end_time"]),
            "preview": text[:200]}


@tool("correct_transcript", "纠正字幕的标点、专有名词、中英文识别错误（不改动时间戳）。需先 transcribe。")
def correct_transcript(ws):
    tr = _transcript(ws)
    if not tr["segments"]:
        return {"error": "没有字幕可纠正，请先 transcribe"}
    if tr.get("source") == "visual":
        return {"skipped": "视觉字幕来自画面描述，无需纠错"}
    text, segs = llm.correct_text(tr["segments"])
    changed = sum(1 for a, b in zip(tr["segments"], segs) if a["text"] != b["text"])
    ws.save("transcript", {"segments": segs, "text": text})
    return {"segments": len(segs), "changed": changed}


@tool("analyze_structure", "按语义把字幕分段（标题、时间范围、三个要点），并挑选重点时间点 heavys。需先有字幕。")
def analyze_structure(ws):
    tr = _transcript(ws)
    if not tr["segments"]:
        return {"error": "没有字幕，无法分段；无语音视频请直接使用画面工具"}
    duration = ws.meta.get("duration") or media.get_video_duration(ws.video_path or "")
    division, heavys = llm.semantic_divide(tr["segments"], duration)
    ws.save("division", division)
    ws.save("heavys", heavys)
    return {"sections": len(division), "heavys": len(heavys), "titles": [d.get("title") for d in division][:12]}


@tool("generate_summary", "基于字幕全文生成整体摘要与亮点。需先有字幕。")
def generate_summary(ws):
    text = _transcript(ws)["text"][:MAX_TEXT_FOR_LLM]
    if not text:
        return {"error": "没有字幕文本"}
    data = llm.generate_summary(text)
    ws.save("summary", data)
    return {"ok": not data.get("failed"), "highlights": data.get("highlights"), "summary_preview": data["summary"][:80]}


@tool("generate_mindmap", "基于字幕全文生成四级思维导图。需先有字幕。")
def generate_mindmap(ws):
    text = _transcript(ws)["text"][:MAX_TEXT_FOR_LLM]
    if not text:
        return {"error": "没有字幕文本"}
    data = llm.generate_mind_map(text)
    ws.save("mind_map", data)
    return {"ok": not data.get("failed")}


@tool(
    "extract_keyframes",
    "按策略截取关键帧。slides=按固定间隔截帧后用 CLIP 相似度去重(适合PPT/板书/切换明显的视频)；"
    "interval=按固定间隔均匀取样不去重(适合口播/画面变化小的视频)。会清除之前的截帧结果。",
    {
        "strategy": {"type": "string", "enum": ["slides", "interval"]},
        "interval_seconds": {"type": "number", "description": "截帧间隔秒数，默认按视频时长自动选择(2/3/5/10)"},
        "similarity_threshold": {"type": "number", "description": "slides 去重阈值 0-1，越高保留越多帧，默认0.95"},
        "max_frames": {"type": "integer", "description": "最多保留多少帧，默认30"},
    },
    ["strategy"],
)
def extract_keyframes(ws, strategy, interval_seconds=None, similarity_threshold=0.95, max_frames=30):
    path = ws.video_path
    if not path:
        return {"error": "视频文件不存在"}
    duration = ws.meta.get("duration") or media.get_video_duration(path)
    interval = float(interval_seconds) if interval_seconds else _default_interval(duration)
    interval = max(0.5, interval)
    fps = 1.0 / interval

    # 清理旧结果（保留 heavy*.png 与 cap_* 截图）
    for f in _frame_files(ws):
        os.remove(f)
    shutil.rmtree(os.path.join(ws.frames_dir, "original_backup"), ignore_errors=True)

    if not media.split_video_to_frames(path, fps, ws.video_id):
        return {"error": "截帧失败（ffmpeg）"}
    raw = len(_frame_files(ws))

    dedupe_backend = None
    if strategy == "slides":
        from app.actions.generate_ppt import generate_ppt  # 懒加载 CLIP
        dedupe_backend = generate_ppt(ws.frames_dir, threshold_input=similarity_threshold)

    files = _frame_files(ws)
    deleted_extra = 0
    if max_frames and len(files) > max_frames:
        keep = set(_subsample(files, int(max_frames)))
        for f in files:
            if f not in keep:
                os.remove(f)
                deleted_extra += 1
        files = _frame_files(ws)

    numbers = [int(os.path.splitext(os.path.basename(f))[0]) for f in files]
    ws.update_meta(fps=fps, frame_numbers=numbers, frame_strategy=strategy)
    out = {"strategy": strategy, "interval_seconds": interval, "raw_frames": raw, "kept_frames": len(files),
           "dropped_by_max_frames": deleted_extra, "dedupe_backend": dedupe_backend}
    if dedupe_backend == "hash":
        out["note"] = "当前使用灰度结构去重，阈值固定，调整 similarity_threshold 无效，无需重复尝试"
    return out


@tool("read_frame_text", "识别关键帧中的文字，按实际帧时间保存。")
def read_frame_text(ws):
    from app.services.ocr import read_frames
    records = read_frames(ws)
    ws.save("ocr", records)
    return {"frames_with_text": len(records)}


@tool("extract_heavy_frames", "按 analyze_structure 挑出的重点时间点截取重点画面 heavy1.png...。需先 analyze_structure。")
def extract_heavy_frames(ws):
    heavys = ws.load("heavys", [])
    if not heavys:
        return {"error": "没有重点时间点，请先 analyze_structure"}
    saved = media.split_video_at_timestamps(ws.video_path, ws.video_id, heavys)
    return {"saved": saved, "requested": len(heavys)}


@tool(
    "write_frame_notes",
    "结合对应时间段字幕，让视觉模型为每个关键帧生成图文 markdown 笔记（并行）。需先 extract_keyframes；有字幕效果更好。",
    {"max_frames": {"type": "integer", "description": "最多处理多少帧，默认30"}},
)
def write_frame_notes(ws, max_frames=30):
    files = _frame_files(ws)
    if not files:
        return {"error": "没有关键帧，请先 extract_keyframes"}
    files = _subsample(files, int(max_frames))
    meta = ws.meta
    fps = meta.get("fps") or 0.2
    duration = meta.get("duration") or 0
    tr = _transcript(ws)
    caps = [] if tr.get("source") == "visual" else tr["segments"]  # 视觉字幕本身来自画面笔记，不回灌

    # 关键帧 n 对应时间 (n-1)/fps；它所代表的片段是 [自己的时间, 下一个关键帧的时间)
    nums = [int(os.path.splitext(os.path.basename(f))[0]) for f in files]
    starts = [(n - 1) / fps for n in nums]
    ends = starts[1:] + [duration if duration > starts[-1] else starts[-1] + 1 / fps]

    def work(args):
        f, s, e = args
        captions = " ".join(c["text"] for c in caps if not (c["end_time"] < s or c["start_time"] > e)) or "无语音内容"
        res = llm.analyze_frame(f, captions, ws.frame_url(os.path.basename(f)))
        return {
            "notes": res["notes"],
            "image": ws.frame_url(os.path.basename(f)),
            "time_range": f"{timedelta(seconds=int(s))} - {timedelta(seconds=int(e))}",
            "captions": captions,
            "failed": bool(res.get("failed")),
        }

    with ThreadPoolExecutor(max_workers=3) as ex:
        segments = list(ex.map(work, zip(files, starts, ends)))
    ws.save("segments", segments)
    failed = sum(1 for s in segments if s["failed"])
    return {"frames_processed": len(segments), "failed": failed}


_MD_IMG = re.compile(r"!\[[^\]]*\]\([^)]*\)")


def _note_to_caption(content: str, limit: int = 420) -> str:
    """把画面笔记(markdown)压成一段纯文本描述，供摘要/脑图/检索使用。"""
    text = _MD_IMG.sub("", content or "")
    text = re.sub(r"^#+\s*", "", text, flags=re.M)
    text = re.sub(r"[*_`>]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


@tool("build_visual_transcript",
      "没有语音（无音轨或识别为空）时，把关键帧笔记整理成带时间戳的'视觉字幕'，使摘要/分段/脑图/关键词/问答都能照常工作。需先 write_frame_notes。")
def build_visual_transcript(ws):
    if _transcript(ws)["segments"] and _transcript(ws).get("source") != "visual":
        return {"skipped": "已有语音字幕，无需视觉字幕"}
    segs = ws.load("segments", [])
    out = []
    for sg in segs:
        if sg.get("failed"):
            continue
        try:
            a, b = [media.parse_timestamp(x.strip()) for x in sg["time_range"].split(" - ")]
        except Exception:  # noqa: BLE001
            continue
        text = _note_to_caption((sg.get("notes") or {}).get("content", ""))
        if text:
            out.append({"start_time": float(a), "end_time": float(b), "text": text})
    if not out:
        return {"error": "没有可用的画面笔记，请先 write_frame_notes"}
    ws.save("transcript", {"segments": out, "text": "\n".join(x["text"] for x in out), "source": "visual"})
    return {"segments": len(out), "source": "visual"}


@tool(
    "view_frame",
    "让视觉模型查看某一帧并回答问题，用于了解画面类型、读取画面文字/图表。frame 是文件名如 0003.png、heavy1.png、cap_65.png。",
    {"frame": {"type": "string"}, "question": {"type": "string"}},
    ["frame", "question"],
    groups=("analyze", "chat"),
)
def view_frame(ws, frame, question):
    path = _safe_frame_path(ws, frame)
    if not path:
        return {"error": f"帧不存在: {frame}（可先 extract_keyframes / capture_frame）"}
    return {"answer": llm.ask_about_image(path, question)}


@tool("validate_result", "检查当前解析结果是否完整、时间戳是否合法，返回问题清单和修复建议。finish 之前调用。")
def validate_result(ws):
    meta = ws.meta
    duration = meta.get("duration") or 0
    issues = []

    tr = _transcript(ws)
    has_speech = bool(tr["segments"])
    if meta.get("has_audio", True) and not has_speech:
        issues.append({"problem": "有音轨但没有字幕", "fix": "确认已执行 transcribe；若确实无语音可忽略"})
    summary = ws.load("summary")
    if has_speech and (not summary or summary.get("failed")):
        issues.append({"problem": "摘要缺失或生成失败", "fix": "调用 generate_summary"})
    mm = ws.load("mind_map")
    if has_speech and (not mm or mm.get("failed")):
        issues.append({"problem": "脑图缺失或生成失败", "fix": "调用 generate_mindmap"})
    division = ws.load("division", [])
    if has_speech and not division:
        issues.append({"problem": "没有语义分段", "fix": "调用 analyze_structure"})
    for d in division:
        end = media.parse_timestamp(d["time_range"]["end_time"])
        if duration and end > duration + 1:
            issues.append({"problem": f"分段时间戳超出视频时长: {d.get('title')}", "fix": "重新 analyze_structure"})
            break
    heavys = ws.load("heavys", [])
    if heavys:
        have = [n for n in os.listdir(ws.frames_dir) if n.startswith("heavy")] if os.path.isdir(ws.frames_dir) else []
        if not have:
            issues.append({"problem": "有重点时间点但未截取重点画面", "fix": "调用 extract_heavy_frames"})
    segments = ws.load("segments", [])
    if not segments:
        issues.append({"problem": "没有关键帧笔记", "fix": "extract_keyframes → write_frame_notes"})
    elif any(s.get("failed") for s in segments):
        issues.append({"problem": f"{sum(1 for s in segments if s.get('failed'))} 个关键帧笔记生成失败",
                       "fix": "重新调用 write_frame_notes"})
    return {"ok": not issues, "issues": issues}


@tool("finish", "收尾：把所有中间产物汇总成最终结果并保存。note 为对结果的简短说明（含未能完成的部分）。",
      {"note": {"type": "string"}})
def finish(ws, note=""):
    summary = ws.load("summary") or {}
    segments = ws.load("segments", [])
    for s in segments:
        s.pop("failed", None)
    mind_map = ws.load("mind_map")
    if not mind_map or "mind_map" not in mind_map:
        mind_map = {"mind_map": {
            "config": {"root_name": "📌暂无脑图", "theme": "light", "default_icon": "📌", "level_styles": {}},
            "data": {"id": "root", "name": "📌暂无脑图", "level": 1, "children": []},
        }}
    mind_map = {"mind_map": mind_map["mind_map"]}  # 去掉内部的 failed 标记，保持前端结构
    result = {
        "summary": summary.get("summary", "该视频没有可用的语音内容，摘要未生成。"),
        "highlights": summary.get("highlights", []),
        "segments": segments,
        "division": ws.load("division", []),
        "heavys": ws.load("heavys", []),
        "mind_map": mind_map,
        "agent_note": note,
        "transcript_source": _transcript(ws).get("source", "speech"),  # speech=语音字幕 / visual=画面生成的视觉字幕
    }
    from app.agent.state import atomic_json
    atomic_json(ws.result_path, result)
    try:  # 入库（字幕分块供出题/检索使用）；数据库故障不应影响解析结果本身
        from app.db import repo
        repo.index_video(ws.video_id, _transcript(ws)["segments"], ws.meta.get("duration", 0))
    except Exception as e:  # noqa: BLE001
        log.warning("视频入库失败（不影响解析结果）: %s", e)
    return {"saved": True, "segments": len(segments)}


# ================================================================ 问答工具
@tool("get_video_overview", "获取已解析视频的摘要、亮点和分段目录（含时间范围）。回答问题前先调用。", groups=("chat",))
def get_video_overview(ws):
    if not os.path.exists(ws.result_path):
        segs = _segments(ws)
        if segs:  # 没有摘要但有字幕：不要让模型误以为视频不可用
            return {"note": "暂无摘要/目录，请直接用 search_transcript 或 get_transcript_window 查字幕作答",
                    "duration": media.seconds_to_hhmmss(ws.meta.get("duration") or segs[-1]["end_time"]),
                    "transcript_segments": len(segs)}
        return {"error": "该视频尚未解析完成"}
    with open(ws.result_path, encoding="utf-8") as f:
        r = json.load(f)
    return {
        "summary": r.get("summary"),
        "highlights": r.get("highlights"),
        "sections": [{"title": d.get("title"), "start": d["time_range"]["start_time"], "end": d["time_range"]["end_time"]}
                     for d in r.get("division", [])],
        "duration": media.seconds_to_hhmmss(ws.meta.get("duration", 0)),
    }


_tokens = _tokens_set


@tool("search_transcript", "在字幕中按关键词检索，返回最相关的片段及时间戳。",
      {"query": {"type": "string"}, "top_k": {"type": "integer", "description": "返回条数，默认5"}},
      ["query"], groups=("chat",))
def search_transcript(ws, query, top_k=5):
    segs = _transcript(ws)["segments"]
    if not segs:
        return {"error": "没有字幕数据"}
    toks = _tokens(query)
    scored = []
    for i, s in enumerate(segs):
        text = s["text"].lower()
        score = sum(1 for t in toks if t in text)
        if score:
            scored.append((score, i))
    scored.sort(key=lambda x: (-x[0], x[1]))
    hits = []
    for _, i in scored[:max(1, int(top_k))]:
        ctx = segs[max(0, i - 1):i + 2]
        hits.append({
            "time": media.seconds_to_hhmmss(segs[i]["start_time"]),
            "text": segs[i]["text"],
            "context": " ".join(c["text"] for c in ctx),
        })
    return {"hits": hits} if hits else {"hits": [], "note": "没有匹配，可换关键词或同义词再试"}


@tool("capture_frame", "在指定时间点截取一帧画面，返回可访问的图片 url 和文件名（可再交给 view_frame 看图）。",
      {"time": {"type": "string", "description": "HH:MM:SS、MM:SS 或秒数"}}, ["time"], groups=("chat",))
def capture_frame(ws, time):
    sec = media.parse_timestamp(time)
    if sec < 0:
        return {"error": f"无法解析时间: {time}"}
    duration = ws.meta.get("duration") or 0
    if duration and sec > duration:
        return {"error": f"时间超出视频时长 {media.seconds_to_hhmmss(duration)}"}
    name = f"cap_{int(sec)}.png"
    if not media.capture_frame_at(ws.video_path, ws.video_id, sec, name):
        return {"error": "截图失败"}
    return {"frame": name, "url": ws.frame_url(name), "time": media.seconds_to_hhmmss(sec)}


# ================================================================ 学习工具（出题 / 核对 / 取字幕）
def _segments(ws):
    segs = _transcript(ws)["segments"]
    if segs:
        return segs
    from app.db import repo
    return repo.get_transcript(ws.video_id)


@tool("get_transcript_window", "取某个时间段内的字幕原文（含时间戳），用于核对细节或引用原话。",
      {"start": {"type": "string", "description": "起点 HH:MM:SS / MM:SS / 秒"},
       "end": {"type": "string", "description": "终点，格式同上"}},
      ["start", "end"], groups=("chat",))
def get_transcript_window(ws, start, end):
    s, e = media.parse_timestamp(start), media.parse_timestamp(end)
    if s < 0 or e < 0 or e < s:
        return {"error": "时间范围不合法"}
    rows = [{"time": media.seconds_to_hhmmss(x["start_time"]), "text": x["text"]}
            for x in _segments(ws) if not (x["end_time"] < s or x["start_time"] > e)]
    return {"segments": rows} if rows else {"segments": [], "note": "该时间段没有字幕"}


@tool(
    "generate_quiz",
    "依据当前视频字幕出题（单选/判断/填空）。每道题的引用都会经过代码校验，必须是字幕原话；校验不过的题会被丢弃或重做，"
    "所以实际题数可能少于请求数。默认只向用户展示题干和选项，用户要求答案时再给答案与解析。",
    {"topic": {"type": "string", "description": "知识点/主题，留空则覆盖全片；主题在字幕里找不到时会如实拒绝"},
     "count": {"type": "integer", "description": "题数，默认5，最多10"},
     "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]}},
    groups=("chat",),
)
def generate_quiz(ws, topic="", count=5, difficulty="medium"):
    from app.db import repo
    count = max(1, min(int(count), 10))
    segs = _segments(ws)
    if not segs:
        return {"error": "该视频没有字幕，无法依据视频出题"}
    res = quiz_service.generate_questions(segs, ws.video_id, topic, count, difficulty)
    if not res["questions"]:
        return {"questions": [], "reason": res.get("reason") or "没有生成出能通过引用校验的题目", "rejected": res["rejected"]}
    repo.register_video(ws.video_id)  # Postgres 外键要求视频已登记
    saved = repo.save_quiz(ws.video_id, None, topic, difficulty, res["questions"])
    return {"quiz_id": saved["id"], "requested": count, "accepted": len(saved["questions"]),
            "rejected_by_verification": res["rejected"], "questions": saved["questions"]}


@tool(
    "verify_claim",
    "核对一条陈述（例如笔记里的术语、公式或结论）是否被视频支持：返回 supported/contradicted/not_found 以及字幕原话和时间戳。"
    "check_visual=true 时还会截取证据时间点的画面，让视觉模型核对画面是否一致（适合公式、图表、板书）。",
    {"claim": {"type": "string"}, "check_visual": {"type": "boolean"}},
    ["claim"], groups=("analyze", "chat"),
)
def verify_claim(ws, claim, check_visual=False):
    segs = _segments(ws)
    if not segs:
        return {"error": "该视频没有字幕"}
    res = quiz_service.verify_claim(segs, ws.video_id, claim)
    if check_visual and res.get("evidence") and ws.video_path:
        t = res["evidence"]["start"]
        name = f"cap_{int(t)}.png"
        if media.capture_frame_at(ws.video_path, ws.video_id, t, name):
            path = _safe_frame_path(ws, name)
            res["visual_check"] = {
                "frame": name, "url": ws.frame_url(name),
                "answer": llm.ask_about_image(path, f"画面内容是否与这条陈述一致？请简短回答并说明依据：{claim}"),
            }
    return res


# ---------------------------------------------------------------- 整门课工具（group=course）
@tool("list_course_videos", "列出这门课包含的所有视频（id、标题、时长）。", groups=("course",))
def list_course_videos(ws):
    from app.db import repo
    course = repo.get_course(ws.course_id)
    if not course:
        return {"error": "课程不存在"}
    return {"course": course["name"], "videos": [
        {"video_id": v["id"], "video_title": v["title"], "duration": media.seconds_to_hhmmss(v["duration"] or 0)}
        for v in course["videos"]]}


@tool("search_course", "在整门课所有视频的字幕里检索，返回命中片段及其所属视频、时间戳。回答跨视频问题时先用它。",
      {"query": {"type": "string"}, "top_k": {"type": "integer", "description": "默认6"}}, ["query"], groups=("course",))
def search_course(ws, query, top_k=6):
    from app import retrieval
    hits = retrieval.for_course(ws.course_id).search(query, min(int(top_k), 10))
    if not hits:
        return {"hits": [], "note": "这门课的字幕里没有匹配内容，可换关键词再试，或回答“课程中未提及”"}
    return {"hits": [{"video_id": h.video_id, "video_title": h.video_title, "time": media.seconds_to_hhmmss(h.start),
                      "text": h.text, "context": h.context} for h in hits]}


@tool("get_video_window", "读取课程中某个视频在指定时间段内的完整字幕。",
      {"video_id": {"type": "string"}, "start": {"type": "string"}, "end": {"type": "string"}},
      ["video_id", "start", "end"], groups=("course",))
def get_video_window(ws, video_id, start, end):
    from app.db import repo
    if video_id not in repo.course_video_ids(ws.course_id):
        return {"error": "该视频不属于这门课"}
    a, b = media.parse_timestamp(start), media.parse_timestamp(end)
    if a < 0 or b < a:
        return {"error": "时间区间不合法"}
    segs = [s for s in repo.get_transcript(video_id) if s["end_time"] >= a and s["start_time"] <= b][:30]
    return {"segments": [{"time": media.seconds_to_hhmmss(s["start_time"]), "text": s["text"]} for s in segs]}


# ---------------------------------------------------------------- 学习记录 / 复习（需要 client_id）
@tool("get_weak_topics", "查看当前学习者的薄弱知识点（按答题记录统计，只看每题最近一次作答），附带视频证据时间戳。",
      groups=("chat", "course"))
def get_weak_topics(ws):
    from app.db import repo
    cid = getattr(ws, "client_id", None)
    if not cid:
        return {"error": "没有学习者标识，无法读取学习记录"}
    out = repo.weak_topics(cid, course_id=getattr(ws, "course_id", None),
                           video_id=None if hasattr(ws, "course_id") else ws.video_id)
    if not out["attempted"]:
        return {"topics": [], "note": "还没有答题记录，先让用户做几道题"}
    return out


@tool("build_review_plan", "为一门课生成复习计划（按考试日期与每日时长排程，薄弱点优先，条目带视频时间戳）。",
      {"exam_date": {"type": "string", "description": "YYYY-MM-DD，可选"},
       "daily_minutes": {"type": "integer", "description": "每天可用分钟数，可选"}}, groups=("course",))
def build_review_plan(ws, exam_date=None, daily_minutes=None):
    import datetime as dt
    from app.services import review
    cid = getattr(ws, "client_id", None)
    if not cid:
        return {"error": "没有学习者标识，无法生成个性化计划"}
    try:
        d = dt.date.fromisoformat(exam_date) if exam_date else None
        plan = review.build_plan(cid, ws.course_id, exam_date=d, daily_minutes=daily_minutes)
    except ValueError as e:
        return {"error": str(e)}
    return {"exam_date": plan["exam_date"], "weak_topics": plan["weak_topics"],
            "days": [{"date": d_["date"], "minutes": d_["minutes"],
                      "items": [{"topic": i["topic"], "video_title": i["video_title"], "time": i["time"],
                                 "minutes": i["minutes"]} for i in d_["items"]]} for d_ in plan["days"]],
            "overflow_count": len(plan["overflow"])}

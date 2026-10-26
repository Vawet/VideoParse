"""千问相关的单步能力（文本纠错、分段、看图写笔记、脑图、摘要）。

每个函数都是"无状态、可重试、失败有兜底"的，Agent 工具层直接调用它们。
"""
import base64
import json
import logging
import re

from app import config
from app.services.media import parse_timestamp, seconds_to_hhmmss

log = logging.getLogger(__name__)


# ----------------------------------------------------------------- 基础
def _parse_json(content: str):
    content = (content or "").strip()
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content)
    return json.loads(content)


def chat_json(messages, model=None, retries=2):
    """调用千问并强制 JSON 返回；解析失败自动重试，最终失败抛异常。"""
    last = None
    for _ in range(retries + 1):
        try:
            completion = config.get_client().chat.completions.create(
                model=model or config.TEXT_MODEL,
                messages=messages,
                stream=False,
                response_format={"type": "json_object"},
                extra_body=config.extra_body(),
            )
            return _parse_json(completion.choices[0].message.content)
        except Exception as e:  # noqa: BLE001
            last = e
            log.warning("LLM JSON 调用失败，重试: %s", e)
    raise last


def format_segments(segments, with_index=False):
    """把字幕片段压成紧凑文本，节省 token：[00:00:01-00:00:05] 文本"""
    lines = []
    for i, s in enumerate(segments):
        prefix = f"{i}|" if with_index else ""
        lines.append(f"{prefix}[{seconds_to_hhmmss(s['start_time'])}-{seconds_to_hhmmss(s['end_time'])}] {s['text']}")
    return "\n".join(lines)


# ----------------------------------------------------------------- 字幕纠错
def correct_text(segments, chunk_size=60):
    """按片段序号纠错（标点、专有名词、中英文），返回 (corrected_text, corrected_segments)。

    时间戳不交给 LLM 改写，只改文本，因此不会出现时间戳被篡改的问题；任何一块失败都回退到原文。
    """
    corrected = [dict(s) for s in segments]
    for begin in range(0, len(segments), chunk_size):
        chunk = segments[begin:begin + chunk_size]
        numbered = "\n".join(f"{begin + i}|{s['text']}" for i, s in enumerate(chunk))
        try:
            result = chat_json([
                {"role": "system", "content": (
                    "你是专业的字幕纠错员。纠正每行字幕的标点符号、专有名词、专业术语以及中英文识别错误，"
                    "不要合并、拆分或增删行，不要改变原意。以 JSON 返回。")},
                {"role": "user", "content": (
                    f"每行格式为 序号|文本。请返回 {{\"segments\": [{{\"i\": 序号, \"text\": 纠正后文本}}, ...]}}\n{numbered}")},
            ])
            for item in result.get("segments", []):
                idx = int(item["i"])
                if 0 <= idx < len(corrected) and isinstance(item.get("text"), str) and item["text"].strip():
                    corrected[idx]["text"] = item["text"].strip()
        except Exception as e:  # noqa: BLE001
            log.error("字幕纠错失败（保留原文）: %s", e)
    return "".join(s["text"] for s in corrected), corrected


# ----------------------------------------------------------------- 语义分段
def _normalize_range(tr, duration):
    """把 LLM 返回的时间范围规整成 {'start_time','end_time'} (HH:MM:SS)，并裁剪到视频时长内。"""
    if not isinstance(tr, dict):
        return None
    start, end = parse_timestamp(tr.get("start_time")), parse_timestamp(tr.get("end_time"))
    if start < 0:
        return None
    if end < start:
        end = start
    if duration:
        start, end = min(start, max(duration - 1, 0)), min(end, duration)
    return {"start_time": seconds_to_hhmmss(start), "end_time": seconds_to_hhmmss(end)}


def semantic_divide(segments, duration=0):
    """返回 (division, heavys)，时间戳已规整到 HH:MM:SS 且不超出视频时长。"""
    result = chat_json([
        {"role": "system", "content": (
            "你是专业的文案理解分段员，按语义把视频字幕划分成段落用于分段总结。要求：\n"
            "1. 每个段落有小标题 title、时间范围 time_range、三个具体的小分点总结 summary(数组)。\n"
            "2. 时间戳只能取自字幕中给出的时间，格式 hh:mm:ss，并拆成 start_time 与 end_time。\n"
            "3. 另外挑出 3-8 个最值得截图的重点内容 heavys，每个有 title 和 time_range。\n"
            "仅返回 JSON。")},
        {"role": "user", "content": (
            f"视频总时长 {seconds_to_hhmmss(duration)}。字幕如下：\n{format_segments(segments)}\n\n"
            '返回格式：{"division":[{"title":"","time_range":{"start_time":"","end_time":""},"summary":["","",""]}],'
            '"heavys":[{"title":"","time_range":{"start_time":"","end_time":""}}]}')},
    ])

    def clean(items, need_summary):
        out = []
        for it in items if isinstance(items, list) else []:
            if not isinstance(it, dict):
                continue
            tr = _normalize_range(it.get("time_range"), duration)
            if not tr:
                continue
            it = dict(it, time_range=tr)
            if need_summary and not isinstance(it.get("summary"), list):
                it["summary"] = [str(it.get("summary", ""))]
            out.append(it)
        return out

    return clean(result.get("division"), True), clean(result.get("heavys"), False)


# ----------------------------------------------------------------- 看图
def _image_to_data_url(image_path):
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    mime = "image/png" if image_path.lower().endswith(".png") else "image/jpeg"
    return f"data:{mime};base64,{b64}"


def ask_about_image(image_path, question, model=None):
    """让视觉模型回答关于某一帧的问题（自由文本）。"""
    completion = config.get_client().chat.completions.create(
        model=model or config.VISION_MODEL,
        messages=[{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": _image_to_data_url(image_path)}},
            {"type": "text", "text": question},
        ]}],
        stream=False,
        extra_body=config.extra_body(),
    )
    return completion.choices[0].message.content


def analyze_frame(image_path, captions, image_url=""):
    """结合字幕解析一帧，返回 {'notes': markdown}；失败返回带错误提示的 notes。"""
    prompt = (
        f"请结合这一时间段的语音内容解析视频这一帧传达的内容：{captions}\n"
        "输出 markdown 图文混排笔记，放进 JSON 的 notes 字段（字符串）。要求：\n"
        "1. 使用三种级别的标题，一般分三点细节解说；开头用一级标题给出≈20字的简洁标题，并附≈100字摘要。\n"
        "2. 既要有专业术语，又要循循善诱。\n"
        "3. 在合适位置加 emoji。\n"
        f"4. 在合适位置用 ![画面]({image_url}) 嵌入这张图。\n"
        '仅返回 JSON：{"notes": "..."}'
    )
    try:
        completion = config.get_client().chat.completions.create(
            model=config.VISION_MODEL,
            messages=[{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": _image_to_data_url(image_path)}},
                {"type": "text", "text": prompt},
            ]}],
            stream=False,
            response_format={"type": "json_object"},
            extra_body=config.extra_body(),
        )
        data = _parse_json(completion.choices[0].message.content)
        notes = data.get("notes", data)
        if isinstance(notes, dict):  # 模型有时会返回 {"content": "..."}
            notes = notes.get("content") or json.dumps(notes, ensure_ascii=False)
        # 前端约定 segments[i].notes.content 为 markdown 文本
        return {"notes": {"content": str(notes)}}
    except Exception as e:  # noqa: BLE001
        log.error("图片分析失败: %s", e)
        return {"notes": {"content": f"# 分析失败\n\n无法解析该画面：{e}"}, "failed": True}


# ----------------------------------------------------------------- 脑图 / 摘要
MIND_MAP_PROMPT = """基于视频全文字幕生成前端可直接渲染的 AI 脑图，仅返回 JSON，不含任何额外文字。结构：
{{"mind_map": {{
  "config": {{"root_name": "视频核心主题(≤15字,带emoji)", "theme": "light", "default_icon": "📌",
    "level_styles": {{"1": {{"font_size":"18px","font_weight":"bold","color":"#2563eb"}},
                     "2": {{"font_size":"16px","font_weight":"bold","color":"#10b981"}},
                     "3": {{"font_size":"14px","font_weight":"normal","color":"#6b7280"}},
                     "4": {{"font_size":"12px","font_weight":"normal","color":"#9ca3af"}}}}}},
  "data": {{"id":"root","name":"📌视频核心主题","level":1,"children":[
    {{"id":"level2_1","name":"🔧二级分类(≤20字,带emoji)","level":2,"children":[
      {{"id":"level3_1_1","name":"📝三级要点(≤25字,带emoji)","level":3,"children":[
        {{"id":"level4_1_1_1","name":"四级补充：通俗解释(≤50字)","level":4,"children":[]}}]}}]}}]}}}}}}
要求：数据严格贴合字幕不添加主观信息；每个节点 id 唯一(level+层级_序号)；1-4 级完整，覆盖核心概念、流程、案例、结论；
专业术语在四级节点补充通俗解释；四级节点 children 固定为空数组。

视频全文字幕：{text}
"""


def generate_mind_map(text):
    try:
        data = chat_json([{"role": "user", "content": MIND_MAP_PROMPT.format(text=text)}])
        if "mind_map" in data and "data" in data["mind_map"]:
            return data
        raise ValueError("脑图结构缺少 mind_map.data")
    except Exception as e:  # noqa: BLE001
        log.error("AI脑图生成失败: %s", e)
        return {"mind_map": {
            "config": {"root_name": "📌脑图生成失败", "theme": "light", "default_icon": "❌",
                       "level_styles": {"1": {"font_size": "18px", "font_weight": "bold", "color": "#ef4444"}}},
            "data": {"id": "root", "name": "📌脑图生成失败", "level": 1,
                     "children": [{"id": "error_1", "name": f"❌错误原因：{e}", "level": 2, "children": []}]},
        }, "failed": True}


def generate_summary(text):
    try:
        data = chat_json([
            {"role": "system", "content": "你是专业的视频内容分析专家，根据文本生成整体摘要和亮点。"},
            {"role": "user", "content": (
                "根据文本生成：\n1. 整体摘要（300字左右），按“该视频主要讲述了... 首先...然后...接着...最后...”描述。\n"
                "2. 检测 2-5 个视频亮点，返回每个亮点的小标题（10字左右）。\n"
                f"文本内容：{text}\n用 JSON 返回，包含 summary(字符串) 和 highlights(字符串数组)。")},
        ])
        if not isinstance(data.get("summary"), str):
            raise ValueError("summary 缺失")
        data.setdefault("highlights", [])
        return data
    except Exception as e:  # noqa: BLE001
        log.error("生成摘要失败: %s", e)
        return {"summary": "无法生成视频摘要", "highlights": ["生成摘要时发生错误"], "failed": True}

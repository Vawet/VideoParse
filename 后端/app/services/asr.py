"""Whisper 语音识别（模型懒加载并缓存）。"""
import logging
import os

log = logging.getLogger(__name__)

_model = None
_model_lock = None


def _get_model():
    global _model, _model_lock
    import threading
    if _model_lock is None:
        _model_lock = threading.Lock()
    with _model_lock:
        if _model is None:
            import torch
            import whisper
            device = "cuda" if torch.cuda.is_available() else "cpu"
            name = os.getenv("WHISPER_MODEL", "turbo")
            log.info("加载 Whisper 模型 %s (%s)", name, device)
            _model = whisper.load_model(name, device=device)
    return _model


_SENT_END = set("。！？!?；;.")
MAX_SEG_SEC = float(os.getenv("ASR_MAX_SEG_SEC", "8"))


def split_segment(seg: dict, max_sec: float = None) -> list:
    """按词级时间戳把粗粒度字幕切成句末标点/不超过 max_sec 的小段，便于证据精确定位。"""
    max_sec = max_sec or MAX_SEG_SEC
    whole = {"start_time": seg["start"], "end_time": seg["end"], "text": seg["text"].strip()}
    words = seg.get("words") or []
    if not words:
        return [whole] if whole["text"] else []
    out, buf, start = [], "", None
    for w in words:
        if start is None:
            start = w["start"]
        buf += w["word"]
        if (buf.strip() and buf.strip()[-1] in _SENT_END) or w["end"] - start >= max_sec:
            if buf.strip():
                out.append({"start_time": start, "end_time": w["end"], "text": buf.strip()})
            buf, start = "", None
    if buf.strip():
        out.append({"start_time": start, "end_time": words[-1]["end"], "text": buf.strip()})
    return out


def speech_to_text(audio_path: str):
    """返回 (segments, text)；失败时返回 ([], "")，保证调用方可统一解包。"""
    if not audio_path or not os.path.exists(audio_path):
        log.error("音频文件不存在: %s", audio_path)
        return [], ""
    try:
        result = _get_model().transcribe(
            audio_path, language=os.getenv("WHISPER_LANGUAGE", "zh"), temperature=0.3, word_timestamps=True,
            # 引导输出简体中文并带标点（不加时 Whisper 常输出繁体）
            initial_prompt=os.getenv("WHISPER_PROMPT", "以下是普通话的句子，使用简体中文和标点符号。"),
        )
        segments = []
        for s in result.get("segments", []):
            segments.extend(split_segment(s))
        return segments, result.get("text", "")
    except Exception as e:  # noqa: BLE001
        log.error("Whisper 识别失败: %s", e, exc_info=True)
        return [], ""

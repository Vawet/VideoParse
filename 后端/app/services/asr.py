"""Whisper 语音识别（模型懒加载并缓存）。"""
import logging
import os

from app import config  # noqa: F401  (确保 ffmpeg 兜底已加入 PATH)

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
_SOFT_BREAK = set("，,、：:")
MAX_SEG_SEC = float(os.getenv("ASR_MAX_SEG_SEC", "8"))


def split_segment(seg: dict, max_sec: float = None) -> list:
    """按词级时间戳把粗粒度字幕切成句末标点/不超过 max_sec 的小段，便于证据精确定位。"""
    max_sec = max_sec or MAX_SEG_SEC
    whole = {"start_time": seg["start"], "end_time": seg["end"], "text": seg["text"].strip()}
    words = seg.get("words") or []
    if not words:
        return [whole] if whole["text"] else []
    out, cur = [], []

    def flush(items):
        text = "".join(w["word"] for w in items).strip()
        if text:
            out.append({"start_time": items[0]["start"], "end_time": items[-1]["end"], "text": text})

    for w in words:
        cur.append(w)
        text = "".join(x["word"] for x in cur).strip()
        if text and text[-1] in _SENT_END:
            flush(cur)
            cur = []
        elif w["end"] - cur[0]["start"] >= max_sec:
            # 过长：优先在最近的逗号/顿号处断开，避免把词切成两半
            cut = next((i for i in range(len(cur) - 1, 0, -1) if cur[i - 1]["word"].strip()[-1:] in _SOFT_BREAK), None)
            if cut:
                flush(cur[:cut])
                cur = cur[cut:]
            else:
                flush(cur)
                cur = []
    if cur:
        flush(cur)
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

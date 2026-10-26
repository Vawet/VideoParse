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


def speech_to_text(audio_path: str):
    """返回 (segments, text)；失败时返回 ([], "")，保证调用方可统一解包。"""
    if not audio_path or not os.path.exists(audio_path):
        log.error("音频文件不存在: %s", audio_path)
        return [], ""
    try:
        result = _get_model().transcribe(
            audio_path, language=os.getenv("WHISPER_LANGUAGE", "zh"), temperature=0.3, word_timestamps=False,
            # 引导输出简体中文并带标点（不加时 Whisper 常输出繁体）
            initial_prompt=os.getenv("WHISPER_PROMPT", "以下是普通话的句子，使用简体中文和标点符号。"),
        )
        segments = [
            {"start_time": s["start"], "end_time": s["end"], "text": s["text"].strip()}
            for s in result.get("segments", [])
        ]
        return segments, result.get("text", "")
    except Exception as e:  # noqa: BLE001
        log.error("Whisper 识别失败: %s", e, exc_info=True)
        return [], ""

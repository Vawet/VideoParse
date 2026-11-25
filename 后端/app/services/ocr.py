"""OCR records are frame observations at a specific time, separate from spoken quotes."""
import logging
import os
import shutil
import subprocess

log = logging.getLogger(__name__)


def read_frames(ws):
    binary = shutil.which("tesseract")
    frames = ws.meta.get("frame_numbers") or []
    fps = ws.meta.get("fps") or 0
    records = []
    if not binary or not fps or not os.path.isdir(ws.frames_dir):
        return records
    for number in frames[:30]:
        filename = f"{number}.png"
        path = os.path.join(ws.frames_dir, filename)
        if not os.path.isfile(path):
            continue
        try:
            result = subprocess.run(
                [binary, path, "stdout", "-l", os.getenv("OCR_LANG", "chi_sim+eng"), "--psm", "6"],
                capture_output=True, text=True, timeout=20,
                env={**os.environ, "OMP_THREAD_LIMIT": "1"},
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            log.warning("关键帧 OCR 失败 %s: %s", filename, exc)
            continue
        text = result.stdout.strip()[:4000]
        if result.returncode == 0 and text:
            records.append({"frame": filename, "start": max(0, (int(number)-1)/fps), "text": text})
    return records

"""ffmpeg 相关：时长、音频、截帧。"""
import glob
import logging
import os
import re
import subprocess

from app import config

log = logging.getLogger(__name__)

TS_RE = re.compile(r"^\d{2}:\d{2}:\d{2}$")


def seconds_to_hhmmss(sec: float) -> str:
    sec = max(0, int(sec))
    return f"{sec // 3600:02d}:{(sec % 3600) // 60:02d}:{sec % 60:02d}"


def parse_timestamp(value) -> float:
    """把 'HH:MM:SS' / 'MM:SS' / 秒数 统一转成秒，失败返回 -1。"""
    if value is None:
        return -1
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    try:
        if ":" in s:
            parts = [float(p) for p in s.split(":")]
            if len(parts) == 3:
                return parts[0] * 3600 + parts[1] * 60 + parts[2]
            if len(parts) == 2:
                return parts[0] * 60 + parts[1]
            return -1
        return float(s)
    except ValueError:
        return -1


def get_video_duration(video_path: str) -> float:
    """获取视频时长（秒），失败返回 0。"""
    try:
        result = subprocess.run(
            ["ffmpeg", "-i", video_path], capture_output=True, text=True, encoding="utf-8", errors="ignore"
        )
        for line in result.stderr.split("\n"):
            if "Duration" in line:
                duration_str = line.split(",")[0].split("Duration: ")[1].strip()
                h, m, s = duration_str.split(":")
                return int(h) * 3600 + int(m) * 60 + float(s)
    except Exception as e:  # noqa: BLE001
        log.error("获取视频时长失败: %s", e)
    return 0


def has_audio_stream(video_path: str) -> bool:
    try:
        result = subprocess.run(
            ["ffmpeg", "-i", video_path], capture_output=True, text=True, encoding="utf-8", errors="ignore"
        )
        return "Audio:" in result.stderr
    except Exception:  # noqa: BLE001
        return False


def extract_audio_from_video(video_path: str, video_id: str):
    """提取 16k 单声道 wav，失败返回 None。"""
    audio_dir = os.path.join(config.AUDIO_FOLDER, video_id)
    os.makedirs(audio_dir, exist_ok=True)
    audio_path = os.path.join(audio_dir, "audio.wav")
    cmd = [
        "ffmpeg", "-i", video_path, "-vn", "-acodec", "pcm_s16le",
        "-ar", "16000", "-ac", "1", "-y", audio_path,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, encoding="utf-8", errors="ignore")
        return audio_path
    except subprocess.CalledProcessError as e:
        log.error("音频提取失败: %s", e.stderr)
    except FileNotFoundError:
        log.error("未找到 ffmpeg，请确保已安装并加入 PATH")
    return None


def split_video_to_frames(video_path: str, fps: float, video_id: str):
    """按 fps 截帧到 frames/<video_id>/%04d.png，失败返回 None。"""
    frames_dir = os.path.join(config.FRAMES_FOLDER, video_id)
    os.makedirs(frames_dir, exist_ok=True)
    cmd = [
        "ffmpeg", "-i", video_path, "-vf", f"fps={fps}", "-f", "image2",
        "-c:v", "png", "-compression_level", "1", "-y",
        os.path.join(frames_dir, "%04d.png"),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, encoding="utf-8", errors="ignore")
        return frames_dir
    except subprocess.CalledProcessError as e:
        log.error("视频切分失败: %s", e.stderr)
    except FileNotFoundError:
        log.error("未找到 ffmpeg")
    return None


def capture_frame_at(video_path: str, video_id: str, seconds: float, out_name: str):
    """在指定秒处截取单帧，返回输出文件路径，失败返回 None。"""
    out_dir = os.path.join(config.FRAMES_FOLDER, video_id)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, out_name)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-ss", f"{max(0.0, seconds):.2f}", "-i", video_path,
        "-vframes", "1", "-f", "image2", "-c:v", "png", "-y", out_path,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, encoding="utf-8", errors="ignore")
        return out_path if os.path.exists(out_path) else None
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        log.error("截图失败 t=%s: %s", seconds, getattr(e, "stderr", e))
        return None


def split_video_at_timestamps(video_path: str, video_id: str, heavys: list):
    """按重点时间戳截取 heavy{n}.png。返回成功截取的文件名列表。"""
    saved = []
    for idx, heavy in enumerate(heavys, start=1):
        start = parse_timestamp((heavy.get("time_range") or {}).get("start_time"))
        if start < 0:
            log.warning("第 %d 个重点缺少有效时间戳，跳过", idx)
            continue
        name = f"heavy{idx}.png"
        if capture_frame_at(video_path, video_id, start, name):
            saved.append(name)
    return saved


def get_sorted_image_files(frames_dir: str):
    """返回 frames_dir 顶层按数字序号排序的帧（忽略 heavy*.png 与备份目录）。"""
    files = []
    for ext in (".jpg", ".jpeg", ".png"):
        files.extend(glob.glob(os.path.join(frames_dir, f"*{ext}")))
    numbered = []
    for f in files:
        stem = os.path.splitext(os.path.basename(f))[0]
        if stem.isdigit():
            numbered.append((int(stem), f))
    return [f for _, f in sorted(numbered)]

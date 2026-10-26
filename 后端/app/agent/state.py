"""每个 video_id 一个工作区：大体量中间产物落盘，只把摘要交给 LLM，避免撑爆上下文。"""
import glob
import json
import os
import threading

from app import config


class Workspace:
    def __init__(self, video_id: str, public_base_url: str = None):
        if not video_id or "/" in video_id or "\\" in video_id or ".." in video_id:
            raise ValueError("非法 video_id")
        self.video_id = video_id
        self.client_id = None  # 学习者匿名标识，由接口层设置
        self.public_base_url = (public_base_url or config.DEFAULT_PUBLIC_BASE_URL).rstrip("/")
        self.work_dir = os.path.join(config.OUTPUT_FOLDER, f"{video_id}_work")
        self.frames_dir = os.path.join(config.FRAMES_FOLDER, video_id)
        self.result_path = os.path.join(config.OUTPUT_FOLDER, f"{video_id}_result.json")
        os.makedirs(self.work_dir, exist_ok=True)
        self._lock = threading.Lock()

    @property
    def video_path(self):
        matches = glob.glob(os.path.join(config.UPLOAD_FOLDER, f"{self.video_id}.*"))
        return matches[0] if matches else None

    # ---- artifact 读写（JSON）
    def _path(self, name):
        return os.path.join(self.work_dir, f"{name}.json")

    def save(self, name, obj):
        with self._lock, open(self._path(name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)

    def load(self, name, default=None):
        p = self._path(name)
        if not os.path.exists(p):
            return default
        with open(p, encoding="utf-8") as f:
            return json.load(f)

    def has(self, name):
        return os.path.exists(self._path(name))

    # ---- 元信息（时长、fps 等）合并写入
    def update_meta(self, **kw):
        meta = self.load("meta", {})
        meta.update(kw)
        self.save("meta", meta)
        return meta

    @property
    def meta(self):
        return self.load("meta", {})

    def frame_url(self, filename):
        return f"{self.public_base_url}/frames/{self.video_id}/{filename}"


class CourseWorkspace:
    """整门课问答用的"工作区"：只承载 course_id，工具通过检索层跨视频查字幕。"""
    video_id = None

    def __init__(self, course_id: str):
        if not course_id or "/" in course_id or ".." in course_id:
            raise ValueError("非法 course_id")
        self.course_id = course_id
        self.client_id = None

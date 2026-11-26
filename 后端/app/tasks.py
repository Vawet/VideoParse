"""内存任务管理：后台线程跑 Agent，事件流通过 SSE 推给前端。"""
import json
import threading
import time
import uuid

_tasks = {}
_lock = threading.Lock()


class Task:
    def __init__(self, video_id):
        self.id = uuid.uuid4().hex
        self.video_id = video_id
        self.status = "running"
        self.events = []
        self.error = None
        self.cond = threading.Condition()
        self.created = time.time()

    def emit(self, event: dict):
        event = dict(event, ts=round(time.time() - self.created, 1))
        with self.cond:
            self.events.append(event)
            self.cond.notify_all()

    def _state(self, status):
        self.status = status
        self.emit({"type": "task_state", "status": status})

    def control(self, pause):
        with self.cond:
            if self.status in ("done", "error"):
                raise ValueError("当前任务已结束解析")
            if pause and self.status == "running":
                self._state("pausing")
            elif not pause and self.status == "pausing":
                raise ValueError("请等待当前步骤保存后继续")
            elif not pause and self.status == "paused":
                self._state("running")
            return self.status

    def checkpoint(self):
        with self.cond:
            while self.status in ("pausing", "paused"):
                if self.status == "pausing":
                    self._state("paused")
                self.cond.wait()

    def finish(self, status, error=None):
        with self.cond:
            if status == "done":
                self.checkpoint()
            self.status, self.error = status, error
            self.events.append({"type": "end", "status": status, "error": error, "ts": round(time.time() - self.created, 1)})
            self.cond.notify_all()


def start_task(video_id, target, *, cooperative=False):
    """Keep one active task per video, including while a worker is paused."""
    with _lock:
        for task in _tasks.values():
            if task.video_id == video_id and task.status not in ("done", "error"):
                return task
        task = Task(video_id)
        _tasks[task.id] = task

    def runner():
        try:
            if cooperative:
                target(task.emit, checkpoint=task.checkpoint)
            else:
                target(task.emit)
            task.finish("done")
        except Exception as e:  # noqa: BLE001
            task.finish("error", str(e))

    threading.Thread(target=runner, daemon=True).start()
    return task


def get_task(task_id):
    return _tasks.get(task_id)


def sse_stream(task: Task, heartbeat=15):
    """生成器：先回放历史事件，再实时推送，直到任务结束。"""
    idx = 0
    while True:
        with task.cond:
            while idx >= len(task.events) and task.status not in ("done", "error"):
                if not task.cond.wait(timeout=heartbeat):
                    break
            batch = task.events[idx:]
            idx += len(batch)
            finished = task.status in ("done", "error") and idx >= len(task.events)
        if not batch:
            if finished:
                return
            yield ": keep-alive\n\n"
            continue
        for ev in batch:
            yield f"data: {json.dumps(ev, ensure_ascii=False, default=str)}\n\n"
        if finished:
            return

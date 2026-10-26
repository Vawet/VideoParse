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
        self.status = "running"  # running / done / error
        self.events = []
        self.error = None
        self.cond = threading.Condition()
        self.created = time.time()

    def emit(self, event: dict):
        event = dict(event, ts=round(time.time() - self.created, 1))
        with self.cond:
            self.events.append(event)
            self.cond.notify_all()

    def finish(self, status, error=None):
        with self.cond:
            self.status, self.error = status, error
            self.events.append({"type": "end", "status": status, "error": error, "ts": round(time.time() - self.created, 1)})
            self.cond.notify_all()


def start_task(video_id, target):
    """target(emit) 在后台线程执行；异常会转成 error 状态。"""
    task = Task(video_id)
    with _lock:
        _tasks[task.id] = task

    def runner():
        try:
            target(task.emit)
            task.finish("done")
        except Exception as e:  # noqa: BLE001
            task.finish("error", str(e))

    threading.Thread(target=runner, daemon=True).start()
    return task


def get_task(task_id):
    return _tasks.get(task_id)


def find_running(video_id):
    with _lock:
        for t in _tasks.values():
            if t.video_id == video_id and t.status == "running":
                return t
    return None


def sse_stream(task: Task, heartbeat=15):
    """生成器：先回放历史事件，再实时推送，直到任务结束。"""
    idx = 0
    while True:
        with task.cond:
            while idx >= len(task.events) and task.status == "running":
                if not task.cond.wait(timeout=heartbeat):
                    break
            batch = task.events[idx:]
            idx += len(batch)
            finished = task.status != "running" and idx >= len(task.events)
        if not batch:
            if finished:
                return
            yield ": keep-alive\n\n"
            continue
        for ev in batch:
            yield f"data: {json.dumps(ev, ensure_ascii=False, default=str)}\n\n"
        if finished:
            return

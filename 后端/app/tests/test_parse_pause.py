"""A pause acknowledgement must drain the active stage and keep the same SSE task alive."""
from threading import Event
from uuid import uuid4

from app import tasks


def test_pause_during_stage_and_resume_same_task():
    started, release, advanced = Event(), Event(), Event()
    video = uuid4().hex

    def work(emit, checkpoint):
        started.set()
        release.wait(3)
        emit({"type": "tool_end"})
        checkpoint()
        advanced.set()

    task = tasks.start_task(video, work, cooperative=True)
    try:
        assert started.wait(2)
        assert task.control(True) == task.control(True) == "pausing"
        assert tasks.start_task(video, work, cooperative=True) is task
        release.set()
        with task.cond:
            assert task.cond.wait_for(lambda: task.status == "paused", timeout=2)
        assert not advanced.is_set()
        stream = tasks.sse_stream(task, heartbeat=.01)
        assert '"pausing"' in next(stream)
        assert '"tool_end"' in next(stream)
        assert '"paused"' in next(stream)
        assert next(stream).startswith(": keep-alive")
        assert task.control(False) == "running"
        assert advanced.wait(2)
        assert any('"end"' in event for event in stream)
        assert task.status == "done"
    finally:
        release.set()
        with task.cond:
            if task.status == "paused":
                task.control(False)

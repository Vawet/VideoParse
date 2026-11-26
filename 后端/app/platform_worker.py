"""Java 队列每次调用一个媒体工作进程，事件用有前缀的 JSON 行传回。"""
import json
import os
import queue
import sys
import threading


def main():
    import fcntl
    from app.agent.loop import analyze_video
    from app.agent.state import Workspace

    job_id, video_id = sys.argv[1:]
    ws = Workspace(video_id)
    ws.job_id = job_id
    # JVM 退出后管道关闭，释放工作区锁，允许新 worker 继续。
    commands = queue.SimpleQueue()

    def watch_parent():
        for command in sys.stdin:
            commands.put(command.strip())
        os._exit(75)
    threading.Thread(target=watch_parent, daemon=True).start()
    def checkpoint():
        if os.environ.get("VP_PAUSE_PROTOCOL") != "1":
            return  # Earlier JVMs only read events; they never grant checkpoints.
        print("VP_CHECKPOINT", flush=True)
        if commands.get() == "pause":
            raise SystemExit(76)

    def emit(event):
        print("VP_EVENT " + json.dumps(event, ensure_ascii=False), flush=True)
    with open(os.path.join(ws.work_dir, ".parse.lock"), "a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        result = analyze_video(ws, emit, checkpoint=checkpoint)
        if not os.path.isfile(result):
            raise RuntimeError("解析未生成结果文件")


if __name__ == "__main__":
    main()

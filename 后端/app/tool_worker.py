"""Private line protocol for Spring. Imported capabilities keep the workbench result contract."""
import fcntl
import json
import os
import queue
import sys
import threading
from app.agent import checkpoints, tools
from app.agent.state import Workspace


def _read_requests(inbox):
    for line in sys.stdin:
        inbox.put(line)
    # Losing the parent during an external model call must release the video lock.
    os._exit(0)


def main():
    job_id, video_id = sys.argv[1:]
    ws = Workspace(video_id)
    ws.job_id = job_id
    inbox = queue.Queue(maxsize=2)
    threading.Thread(target=_read_requests, args=(inbox,), daemon=True).start()
    with open(os.path.join(ws.work_dir, ".parse.lock"), "a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        while True:
            message = json.loads(inbox.get())
            tool, args = message["tool"], message["args"]
            if tool == "close":
                return
            try:
                stamp = checkpoints.key(ws, tool, args)
                result = checkpoints.read(ws, tool, stamp)
                if result is None:
                    result = tools.run_tool(tool, ws, args, "analyze")
                    checkpoints.write(ws, stamp, result)
                else:
                    result = {**result, "resumed": True}
            except Exception as exc:
                result = {"error": str(exc)}
            print("VP_RESULT " + json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()

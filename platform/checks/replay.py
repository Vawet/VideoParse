"""Read-only check for the EventSource contract of an already completed task."""
import argparse
import json
from urllib.request import Request, urlopen


def replay(base, task_id, after=None):
    headers = {"Accept": "text/event-stream"}
    if after is not None:
        headers["Last-Event-ID"] = str(after)
    req = Request(f"{base.rstrip('/')}/tasks/{task_id}/events", headers=headers)
    events = []
    with urlopen(req, timeout=15) as response:
        assert response.headers.get_content_type() == "text/event-stream", response.headers
        event_id = None
        for line in response:
            if line.startswith(b"id: "):
                event_id = int(line[4:])
            elif line.startswith(b"data: "):
                assert event_id is not None
                events.append((event_id, json.loads(line[6:])))
    return events


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("api_base")
    p.add_argument("completed_task_id")
    args = p.parse_args()
    rows = replay(args.api_base, args.completed_task_id)
    assert rows and rows[-1][1]["type"] == "end"
    assert [row[0] for row in rows] == sorted({row[0] for row in rows})
    cursor = len(rows) // 2
    assert replay(args.api_base, args.completed_task_id, rows[cursor][0]) == rows[cursor + 1:]
    print(f"验证通过：{len(rows)} 个事件、浏览器 SSE 类型、从游标续读")

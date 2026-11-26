"""Long-lived, private Spring worker for learning tools. Only allow listed operations."""
import json
import logging
import os
import sys
from app import api_usage, bilibili_worker, learning_api
from app.services import document_interview

OPERATIONS = {name: getattr(learning_api, name) for name in (
    "get_keywords", "chat", "search_if_requested", "document_answer", "document_route", "document_web_sources", "review_weak", "review_plan", "review_done", "teach_plan",
    "teach_plan_get", "teach_plan_revise", "quiz_generate", "quiz_get", "quiz_answer", "verify",
)}
OPERATIONS.update(document_interview=document_interview.run, bilibili_import=bilibili_worker.import_video, bilibili_comments=bilibili_worker.analyze_comments)


def main():
    for line in sys.stdin:
        try:
            message = json.loads(line)
            args = message["args"]
            operation = message["tool"]
            kwargs = {"session_token": args.get("session_token")} if operation == "chat" else {}
            with api_usage.scope(operation, args["usage_owner"]):
                payload, status = OPERATIONS[operation](args["params"], os.environ.get("PUBLIC_BASE_URL", "/api"),
                                                       *args["path"], **kwargs)
        except Exception:
            logging.exception("学习工具执行失败")
            payload, status = {"success": False, "error": "学习工具执行失败"}, 500
        print("VP_RESULT " + json.dumps({"status": status, "body": payload}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()

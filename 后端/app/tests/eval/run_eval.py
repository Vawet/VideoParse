"""用真实模型跑评测：  cd 后端 && ./.venv/bin/python -m app.tests.eval.run_eval
输出：引用通过率 / 命中率 / 拒答率 / 出题通过率 / token 与耗时。不会碰你的真实数据库和上传目录。"""
import json
import os
import tempfile
import time

from app import config


class _Usage:
    prompt = completion = calls = 0


def _count_usage(client):
    orig = client.chat.completions.create

    def wrapped(*a, **kw):
        r = orig(*a, **kw)
        _Usage.calls += 1
        u = getattr(r, "usage", None)
        if u:
            _Usage.prompt += getattr(u, "prompt_tokens", 0) or 0
            _Usage.completion += getattr(u, "completion_tokens", 0) or 0
        return r

    client.chat.completions.create = wrapped
    return client


def main():
    tmp = tempfile.mkdtemp(prefix="vp_eval_")
    for attr in ("UPLOAD_FOLDER", "FRAMES_FOLDER", "AUDIO_FOLDER", "OUTPUT_FOLDER"):
        os.makedirs(os.path.join(tmp, attr))
        setattr(config, attr, os.path.join(tmp, attr))
    config.DATABASE_URL = f"sqlite:///{tmp}/eval.db"

    from app.agent import loop
    from app.agent.state import Workspace
    from app.db import repo, session
    from app.services import quiz
    from app.tests.eval import metrics

    session.reset_engine()
    gold = json.load(open(os.path.join(os.path.dirname(__file__), "golden.json"), encoding="utf-8"))
    ws = Workspace(gold["video_id"])
    ws.save("transcript", {"segments": gold["segments"], "text": ""})
    ws.update_meta(duration=gold["duration"], has_audio=True)
    repo.index_video(gold["video_id"], gold["segments"], gold["duration"])

    client = _count_usage(config.get_client())
    config.get_client = lambda: client

    t0, rows = time.time(), []
    for item in gold["questions"]:
        answer, _, cites = loop.chat_with_video(ws, [], item["q"])
        row = metrics.score_answer(item, answer, cites)
        rows.append(row)
        print(("✓" if row.get("hit") or row.get("refused") else "✗"), item["q"], "→", answer[:60].replace("\n", " "))
    chat = metrics.summarize(rows)
    chat_time = time.time() - t0

    t1 = time.time()
    qz = metrics.quiz_stats(quiz.generate_questions(gold["segments"], gold["video_id"], count=5), 5)
    report = {"chat": chat, "quiz": qz,
              "cost": {"llm_calls": _Usage.calls, "prompt_tokens": _Usage.prompt, "completion_tokens": _Usage.completion,
                       "chat_seconds": round(chat_time, 1), "quiz_seconds": round(time.time() - t1, 1)}}
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

"""评测框架本身的离线自检：指标计算正确、金标数据自洽（可回答题的区间确实有对应字幕）。"""
import json
import os

from app.agent import loop
from app.tests.eval import metrics

GOLD = json.load(open(os.path.join(os.path.dirname(__file__), "eval", "golden.json"), encoding="utf-8"))


def test_golden_set_is_self_consistent():
    segs = GOLD["segments"]
    for item in GOLD["questions"]:
        if item["answerable"]:
            lo, hi = item["expect_range"]
            assert any(s["start_time"] >= lo and s["end_time"] <= hi for s in segs), item["q"]
    assert sum(not q["answerable"] for q in GOLD["questions"]) >= 2


def test_metrics_with_scripted_answers(learn_env, monkeypatch):
    from app.agent.state import Workspace
    from app.db import repo

    ws = Workspace(GOLD["video_id"])
    ws.save("transcript", {"segments": GOLD["segments"], "text": ""})
    repo.index_video(GOLD["video_id"], GOLD["segments"], GOLD["duration"])

    scripted = {
        "自注意力里每个词会生成哪三个向量？": "查询、键、值 [00:20]",          # 命中
        "注意力权重是怎么算出来的？": "点积计算 [01:35]",                        # 时间戳有效但位置错
        "为什么要加位置编码？": "因为需要顺序信息 [09:59]",                      # 编造时间戳（重试后仍编造）
        "视频里有没有讲区块链的共识算法？": "视频中未提及",                        # 正确拒答
        "老师推荐了哪本参考书？": "推荐了《深度学习》 [00:10]",                    # 该拒答却硬答
    }
    monkeypatch.setattr(loop, "run_agent", lambda g, w, messages, e, max_steps=0: scripted[
        next(m["content"] for m in messages if m["role"] == "user" and m["content"] in scripted)])
    rows = []
    for item in GOLD["questions"]:
        if item["q"] not in scripted:
            continue
        answer, _, cites = loop.chat_with_video(ws, [], item["q"])
        rows.append(metrics.score_answer(item, answer, cites))
    s = metrics.summarize(rows)
    assert s["n_answerable"] == 3 and s["n_unanswerable"] == 2
    assert s["citation_pass_rate"] == round(2 / 3, 3)   # 两题有有效引用
    assert s["hit_rate"] == round(1 / 3, 3)             # 只有一题位置对
    assert s["refusal_rate"] == 0.5
    assert s["bad_citation_total"] >= 1


def test_quiz_stats():
    assert metrics.quiz_stats({"questions": [1, 2, 3], "rejected": 2, "rounds": 2}, 5)["accept_rate"] == 0.6

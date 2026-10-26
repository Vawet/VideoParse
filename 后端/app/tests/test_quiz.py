"""按需出题 / 核对 / 判分 / 接口：用脚本化的假 LLM，验证"引用校验"确实挡住了编造的题。"""
import pytest

from app.agent import tools
from app.services import llm, quiz


def good_q(stem="自注意力中每个词会生成哪三个向量？", quote="每个词会生成查询键和值三个向量", start="00:00:10", **kw):
    q = {"qtype": "single", "stem": stem, "options": ["查询、键、值", "输入、输出、隐藏", "权重、偏置、激活", "词、位置、段"],
         "answer": "A", "explanation": "见字幕", "topic": "自注意力",
         "evidence": [{"start": start, "quote": quote}]}
    q.update(kw)
    return q


def scripted(*rounds):
    it = iter(rounds)
    calls = []

    def fake(messages, **kw):
        calls.append(messages)
        return {"questions": next(it)}

    fake.calls = calls
    return fake


def test_fabricated_and_malformed_questions_are_rejected_then_replaced(learn_env):
    fabricated = good_q(stem="编造题", quote="反向传播用于更新所有层的权重参数")
    malformed = {"qtype": "single", "stem": "没有选项", "answer": "A", "evidence": []}
    fake = scripted([good_q(), fabricated, malformed],
                    [good_q(stem="Transformer 的优势是什么？", quote="Transformer的优势是可以并行计算", start="00:00:50",
                            options=["并行计算", "更少参数", "不需要数据", "只能处理图像"])])
    res = quiz.generate_questions(learn_env.segments, "vid-learn", count=2, chat_json=fake)
    assert [q["stem"][:6] for q in res["questions"]] == ["自注意力中每", "Transf"]
    assert res["rejected"] == 2 and res["rounds"] == 2
    assert all(q["verified"] and q["evidence"] for q in res["questions"])
    assert "逐字摘录" in fake.calls[1][1]["content"]  # 第二轮带着"被拒原因"的反馈


def test_wrong_timestamp_is_corrected_when_quote_is_real(learn_env):
    fake = scripted([good_q(start="00:00:20")])  # 引用真实，但时间戳写偏了 10 秒以内
    res = quiz.generate_questions(learn_env.segments, "vid-learn", count=1, chat_json=fake)
    ev = res["questions"][0]["evidence"][0]
    assert (ev["start"], ev["end"]) == (10.0, 30.0)


def test_gives_up_after_max_rounds_and_reports_honestly(learn_env):
    bad = good_q(quote="完全没有出现过的一句话内容在这里")
    fake = scripted([bad], [bad], [bad])
    res = quiz.generate_questions(learn_env.segments, "vid-learn", count=3, chat_json=fake)
    assert res["questions"] == [] and res["rejected"] == 3 and res["rounds"] == quiz.MAX_ROUNDS


def test_topic_not_in_transcript_refuses_without_calling_llm(learn_env):
    def boom(messages, **kw):
        raise AssertionError("不应调用 LLM")

    res = quiz.generate_questions(learn_env.segments, "vid-learn", topic="区块链共识算法", chat_json=boom)
    assert res["questions"] == [] and "没有找到" in res["reason"]


def test_answer_written_as_option_text_is_mapped_to_letter(learn_env):
    fake = scripted([good_q(answer="查询、键、值")])
    res = quiz.generate_questions(learn_env.segments, "vid-learn", count=1, chat_json=fake)
    assert res["questions"][0]["answer"] == "A"


@pytest.mark.parametrize("q,given,expected", [
    ({"qtype": "single", "answer": "B"}, "b", True),
    ({"qtype": "single", "answer": "B"}, "A. 查询", False),
    ({"qtype": "judge", "answer": "对"}, "正确", True),
    ({"qtype": "judge", "answer": "错"}, "对", False),
    ({"qtype": "blank", "answer": "并行计算"}, "并行 计算", True),
    ({"qtype": "blank", "answer": "并行计算"}, "", False),
])
def test_grade_answer(q, given, expected):
    assert quiz.grade_answer(q, given) is expected


def test_verify_claim_downgrades_unverifiable_verdicts(learn_env):
    supported_real = lambda m, **kw: {"verdict": "supported", "start": "00:00:50", "quote": "可以并行计算训练速度快", "reason": "r"}
    r = quiz.verify_claim(learn_env.segments, "vid-learn", "Transformer 可以并行计算", chat_json=supported_real)
    assert r["verdict"] == "supported" and r["evidence"]["start"] == 50.0

    supported_fake = lambda m, **kw: {"verdict": "supported", "start": "00:00:50", "quote": "编造的一句原话不在字幕中", "reason": "r"}
    r = quiz.verify_claim(learn_env.segments, "vid-learn", "Transformer 可以并行计算", chat_json=supported_fake)
    assert r["verdict"] == "not_found" and "降级" in r["reason"]

    r = quiz.verify_claim(learn_env.segments, "vid-learn", "区块链共识", chat_json=lambda m, **kw: 1 / 0)
    assert r["verdict"] == "not_found"


def test_generate_quiz_tool_persists_and_returns_questions(learn_env, monkeypatch):
    from app.db import repo

    monkeypatch.setattr(llm, "chat_json", scripted([good_q()]))
    out = tools.run_tool("generate_quiz", learn_env.ws, {"count": 1}, "chat")
    assert out["accepted"] == 1 and out["quiz_id"]
    assert repo.get_quiz(out["quiz_id"], with_answer=True)["questions"][0]["verified"] is True


def test_get_transcript_window_tool(learn_env):
    out = tools.run_tool("get_transcript_window", learn_env.ws, {"start": "00:00:10", "end": "00:00:30"}, "chat")
    # 区间 [10,30] 与 [0,10]、[10,30]、[30,50] 三段相交（边界含）
    assert [s["time"] for s in out["segments"]] == ["00:00:00", "00:00:10", "00:00:30"]
    assert "error" in tools.run_tool("get_transcript_window", learn_env.ws, {"start": "5", "end": "1"}, "chat")


# ------------------------------------------------------------------ HTTP
def test_http_quiz_flow_hides_answers_until_answered_and_records_attempts(learn_env, monkeypatch):
    from app import main
    from app.db import repo

    monkeypatch.setattr(llm, "chat_json", scripted([good_q()]))
    c = main.app.test_client()
    r = c.post("/quiz/generate", json={"video_id": "vid-learn", "count": 1}).get_json()
    assert r["success"] and r["quiz_id"] and "answer" not in r["questions"][0] and "explanation" not in r["questions"][0]
    qid = r["questions"][0]["id"]

    wrong = c.post(f"/quiz/{r['quiz_id']}/answer", json={"client_id": "u1", "question_id": qid, "answer": "B"}).get_json()
    assert wrong["correct"] is False and wrong["answer"] == "A" and wrong["evidence"][0]["quote"]
    right = c.post(f"/quiz/{r['quiz_id']}/answer", json={"client_id": "u1", "question_id": qid, "answer": "A"}).get_json()
    assert right["correct"] is True

    from app.db.models import Attempt
    from app.db.session import get_session
    with get_session() as s:
        assert [a.correct for a in s.query(Attempt).order_by(Attempt.id)] == [False, True]

    assert c.post(f"/quiz/{r['quiz_id']}/answer", json={"question_id": "nope", "answer": "A"}).status_code == 404
    assert c.get("/quiz/zzz").status_code == 404


def test_http_quiz_refusal_and_verify(learn_env, monkeypatch):
    from app import main

    c = main.app.test_client()
    r = c.post("/quiz/generate", json={"video_id": "vid-learn", "topic": "区块链共识算法"}).get_json()
    assert r["success"] and r["questions"] == [] and "没有找到" in r["reason"]

    monkeypatch.setattr(llm, "chat_json", lambda m, **kw: {
        "verdict": "supported", "start": "00:00:50", "quote": "可以并行计算训练速度快", "reason": "r"})
    v = c.post("/verify", json={"video_id": "vid-learn", "claim": "Transformer 可以并行计算"}).get_json()
    assert v["success"] and v["verdict"] == "supported"
    assert c.post("/verify", json={"video_id": "vid-learn"}).get_json()["success"] is False


# ------------------------------------------------------------------ 问答强制时间戳
def test_extract_citations_validates_against_transcript(learn_env):
    from app.agent import loop

    cites = loop.extract_citations("见 [00:12] 和 [01:00] 以及 [09:59]，还有 1:01:05 之类", learn_env.segments)
    by = {c["time"]: c for c in cites}
    assert by["00:00:12"]["valid"] and "查询" in by["00:00:12"]["text"]
    assert by["00:01:00"]["valid"]            # 落在 50-70s 的字幕里
    assert not by["00:09:59"]["valid"] and not by["01:01:05"]["valid"]


class _Seq:
    """每次调用 run_agent 依次返回预设回答，并记录收到的消息。"""
    def __init__(self, *answers):
        self.answers, self.seen = list(answers), []

    def __call__(self, mode, ws, messages, emit, max_steps=0):
        self.seen.append([m["content"] for m in messages])
        return self.answers.pop(0)


def test_chat_asks_again_when_answer_has_no_evidence(learn_env, monkeypatch):
    from app.agent import loop

    seq = _Seq("自注意力会生成三个向量。", "自注意力会生成查询、键、值三个向量 [00:12]。")
    monkeypatch.setattr(loop, "run_agent", seq)
    answer, history, cites = loop.chat_with_video(learn_env.ws, [], "自注意力是什么？")
    assert "[00:12]" in answer and cites[0]["valid"]
    assert len(seq.seen) == 2 and "缺少有效的字幕时间戳" in seq.seen[1][-1]
    assert history[-1]["content"] == answer


def test_chat_accepts_explicit_not_mentioned_without_retry(learn_env, monkeypatch):
    from app.agent import loop

    seq = _Seq("视频中未提及区块链。")
    monkeypatch.setattr(loop, "run_agent", seq)
    answer, _, cites = loop.chat_with_video(learn_env.ws, [], "区块链是什么？")
    assert len(seq.seen) == 1 and cites == []


def test_chat_second_failure_is_returned_with_invalid_citations(learn_env, monkeypatch):
    from app.agent import loop

    monkeypatch.setattr(loop, "run_agent", _Seq("编的 [09:59]", "还是编的 [08:00]"))
    _, _, cites = loop.chat_with_video(learn_env.ws, [], "?")
    assert cites and not any(c["valid"] for c in cites)  # 前端可据此标红提示

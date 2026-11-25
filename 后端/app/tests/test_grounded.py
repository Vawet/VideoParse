from app import learning_api
from app.services import grounded


def test_document_answer_retains_only_individually_supported_claims(monkeypatch):
    quotes = ["主动回忆", "间隔复习", "交错练习", "及时反馈", "总结反思"]
    passage = "可采用" + "、".join(quotes) + "。"
    supported = [{"id": 1, "quote": quote, "answer": "可以" + quote + "。"} for quote in quotes]
    monkeypatch.setenv("LLM_API_KEY", "offline-test")
    monkeypatch.setattr(grounded.llm, "chat_json", lambda *a, **kw: {
        "claims": [None, {"answer": "缺少依据"}, {**supported[0], "id": True},
                   {**supported[0], "quote": "未出现的词"}, *supported]
    })
    reply, status = learning_api.document_answer({"question": "如何记忆？", "excerpts": [passage]}, "/api")
    assert status == 200 and reply["claims"] == supported[:4]


def test_chat_history_and_separate_supplement(monkeypatch):
    prompt = {}
    def generate(messages, **kwargs):
        import json
        prompt.update(json.loads(messages[-1]["content"]))
        return {"claims": [{"id": 1, "answer": "虚构", "quote": "没有此引文"}],
                "explanation": "队列遵循先进先出。", "reasoning_content": "private"}
    monkeypatch.setenv("LLM_API_KEY", "offline-test")
    monkeypatch.setattr(grounded.llm, "chat_json", generate)
    history = [{"role": "user", "content": "队列" * 1000}] * 12
    params = {"question": "举个例子", "history": history, "excerpts": ["什么是队列？"]}
    body, _ = learning_api.document_answer({**params, "allow_explanation": True}, "/api")
    assert body["model_status"] == "completed" and body["explanation"] == "队列遵循先进先出。"
    assert not body["claims"] and "reasoning_content" not in body
    assert len(prompt["history"]) == 8 and len(prompt["history"][0]["content"]) == 1200
    strict, _ = learning_api.document_answer(params, "/api")
    assert strict["explanation"] == "" and not strict["claims"]

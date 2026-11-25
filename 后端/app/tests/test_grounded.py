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

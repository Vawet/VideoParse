from app import learning_api
from app.services import grounded


def test_document_answer_retains_only_individually_supported_claims(monkeypatch):
    passage = "主动回忆有助于长期记忆。"
    supported = {"id": 1, "quote": "主动回忆", "answer": "可以主动回忆。"}
    monkeypatch.setenv("LLM_API_KEY", "offline-test")
    monkeypatch.setattr(grounded.llm, "chat_json", lambda *a, **kw: {
        "claims": [None, supported, {"answer": "缺少依据"}, {**supported, "quote": "未出现的词"}]
    })
    reply, status = learning_api.document_answer({"question": "如何记忆？", "excerpts": [passage]}, "/api")
    assert status == 200 and reply["claims"] == [supported]

import io

import pytest

from app import upload_gate


@pytest.fixture
def client(env, monkeypatch):  # noqa: F811
    from app.main import app
    upload_gate._tokens.clear()
    upload_gate._fails.clear()
    monkeypatch.delenv("UPLOAD_ANSWER", raising=False)
    return app.test_client()


from app.tests.test_agent_offline import env  # noqa: E402,F401


def _upload(c, token=None):
    data = {"video": (io.BytesIO(b"fake"), "a.mp4")}
    if token is not None:
        data["token"] = token
    return c.post("/upload", data=data, content_type="multipart/form-data")


def test_question_is_public_but_answer_is_not(client):
    j = client.get("/upload/question").get_json()
    assert j["required"] and "名字" in j["question"] and "陆鑫" not in str(j)


def test_upload_rejected_without_token(client):
    r = _upload(client)
    assert r.status_code == 403 and not r.get_json()["success"]
    assert _upload(client, "forged").status_code == 403


def test_wrong_answer_then_right_answer_then_single_use(client):
    assert client.post("/upload/verify", json={"answer": "张三"}).status_code == 403
    ok = client.post("/upload/verify", json={"answer": " 陆鑫 "})
    token = ok.get_json()["token"]
    assert _upload(client, token).get_json()["success"] is True
    assert _upload(client, token).status_code == 403            # 令牌一次性


def test_bruteforce_lockout(client):
    for _ in range(upload_gate.MAX_FAILS):
        client.post("/upload/verify", json={"answer": "x"})
    r = client.post("/upload/verify", json={"answer": "陆鑫"})   # 锁定后连正确答案也要等
    assert r.status_code == 429


def test_token_expires(client, monkeypatch):
    token = client.post("/upload/verify", json={"answer": "陆鑫"}).get_json()["token"]
    upload_gate._tokens[token] = 0
    assert _upload(client, token).status_code == 403


def test_gate_can_be_disabled(client, monkeypatch):
    monkeypatch.setenv("UPLOAD_ANSWER", "")
    assert _upload(client).get_json()["success"] is True

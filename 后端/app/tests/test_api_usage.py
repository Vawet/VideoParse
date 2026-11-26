"""Money can be spent on failed business results and SDK retries. Test at the HTTP boundary."""
import json
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from openai import OpenAI

from app import api_usage, config
from app.services import llm, web_search


@pytest.fixture
def ledger(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_URL", "sqlite:///" + str(tmp_path / "learning.db"))
    monkeypatch.delenv("VP_USAGE_OWNER", raising=False)
    return api_usage


def test_receipts_for_sdk_retry_and_paid_invalid_content(ledger, monkeypatch):
    replies = iter([(429, {"total_tokens":1}), (200, {"total_tokens": 15}), (200, {"prompt_tokens": 8, "completion_tokens": 3})])
    def handle(request):
        # The attempt must be visible to another connection while still in flight.
        assert ledger.page("alice")["items"][0]["status"] == "awaiting"
        status, usage = next(replies)
        return httpx.Response(status, headers={"retry-after-ms": "1"}, json={
            "usage": usage, "model":"fixture",
            "choices":[{"index":0,"message":{"role":"assistant","content":"{}" if "prompt_tokens" in usage else "broken"}}]})
    client = OpenAI(api_key="fixture", base_url="https://mock.invalid/v1", max_retries=1,
                    http_client=api_usage.MeteredHttpClient(transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(config, "get_client", lambda:client)
    with client, ledger.scope("generate_summary","alice"):
        assert llm.chat_json([{"role":"user","content":"private-input-never-store"}], retries=1) == {}
    data = ledger.page("alice")
    assert data["summary"] == dict(requests=3, tokens=27, estimated_usd_micros=0, unconfirmed=0)
    assert [i["status"] for i in data["items"]] == ["reported","reported","failed_reported"]
    assert data["items"][1]["input_tokens"] is None
    assert "private-input" not in json.dumps(data)
    assert ledger.page("bob")["summary"]["requests"] == 0


def test_missing_usage_network_failure_and_zero(ledger):
    def handle(req):
        if req.url.path == "/failure":
            raise httpx.ReadTimeout("offline")
        return httpx.Response(200, json={"usage": {"total_tokens":0}} if req.url.path == "/zero" else {})
    with ledger.MeteredHttpClient(transport=httpx.MockTransport(handle)) as client:
        for path in ("empty","zero"):
            client.post("https://stub.invalid/"+path, json={"model":"mock"})
        with pytest.raises(httpx.ReadTimeout):
            client.post("https://stub.invalid/failure", json={"model":"mock"})
    from app.main import app
    page = app.test_client().get("/usage").get_json()
    assert page["summary"] == dict(requests=3, tokens=0, estimated_usd_micros=0, unconfirmed=2)
    assert [(i["status"],i["total_tokens"]) for i in page["items"]] == [
        ("failed",None),("reported",0),("unreported",None)]


def test_search_price_and_worker_scope_pagination(ledger, monkeypatch):
    monkeypatch.setenv("BRAVE_SEARCH_API_KEY","fixture")
    monkeypatch.setenv("BRAVE_USD_PER_REQUEST","0.001234")
    class Reply:
        status_code = 200
        def json(self): return {"web":{"results":[]}}
        def raise_for_status(self): pass
    monkeypatch.setattr(web_search.requests,"get",lambda *a,**kw:Reply())
    def call(owner):
        with ledger.scope("document_web_sources",owner):
            return web_search.search("private query")
    with ThreadPoolExecutor(3) as pool:
        list(pool.map(call,["one"]*31+["two"]*2))
    with ledger.scope("chat","one"):
        receipt = ledger.start("fixture","model")
        ledger.finish(receipt,"unreported",usage={"prompt_tokens":9})
    first = ledger.page("one")
    second = ledger.page("one",first["next"])
    assert first["summary"] == dict(requests=32, tokens=9, estimated_usd_micros=38254, unconfirmed=1)
    assert first["items"][0]["status"] == "partial"
    assert len(first["items"]) == 30 and len(second["items"]) == 2 and second["next"] is None
    assert second["items"][0]["id"] < first["items"][-1]["id"]
    assert ledger.page("two")["summary"]["estimated_usd_micros"] == 2468
    assert ledger.page("local")["summary"]["requests"] == 0

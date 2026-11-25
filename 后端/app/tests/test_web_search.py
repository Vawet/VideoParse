import pytest
from app.services import web_search
from app import learning_api


@pytest.mark.parametrize(("question","web"), [
    ("02:14 这里为什么除以标准差？", False), ("视频里的最新结论是什么？", False),
    ("老师推荐了哪些参考资料？", False), ("不要联网，讲讲这个公式", False),
    ("上网查一下 Transformer 原论文", True), ("Python asyncio 的官方文档在哪里？", True),
    ("最近有哪些注意力机制的新进展？", True), ("刚才那一步呢？", False),
])
def test_routing(question, web):
    assert web_search.needs_web(question) is web


def test_web_contract_and_query_privacy(monkeypatch):
    monkeypatch.delenv("BRAVE_SEARCH_API_KEY", raising=False)
    monkeypatch.setattr(web_search.grounded, "claims", lambda question, excerpts: [])
    class Fixture:
        content = b'<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fdoc">Docs</a><span class="result__snippet">A public excerpt.</span></div>'
        def raise_for_status(self): pass
    def fetch(url, params, headers, timeout):
        assert params == {"q": "Python official docs"}
        assert "Cookie" not in headers
        return Fixture()
    monkeypatch.setattr(web_search.requests, "get", fetch)
    reply, status = learning_api.chat({"question":"联网搜索 Python official docs", "video_id":"private",
                                      "history":[{"role":"user","content":"private note"}]}, "/api")
    assert status == 200 and not reply["citations"]
    assert reply["web_sources"][0]["url"] == "https://example.org/doc"
    assert reply["source"] == "web"


def test_search_failure(monkeypatch):
    def unavailable(_): raise web_search.requests.Timeout()
    monkeypatch.setattr(web_search, "search", unavailable)
    assert web_search.web_reply("official docs")[1] == 503
    assert web_search._url("javascript:void(0)") is None
    assert web_search._url("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fa%0Ab") is None

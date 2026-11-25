import pytest
from app.services import web_search
from app import learning_api


@pytest.mark.parametrize(("question","web"), [
    ("02:14 这里为什么除以标准差？", False), ("视频里的最新结论是什么？", False),
    ("老师推荐了哪些参考资料？", False), ("不要联网，讲讲这个公式", False),
    ("上网查一下 Transformer 原论文", True), ("Python asyncio 的官方文档在哪里？", True),
    ("最近有哪些注意力机制的新进展？", True), ("刚才那一步呢？", False),
    ("只根据我的笔记，整理提到的官方文档", False), ("仅依据已上传的资料，找出最新研究", False),
    ("别去网上查，这些参考资料是怎么分类的？", False), ("Use only my notes to find the latest release.", False),
    ("不要只看视频，联网搜索官方文档", True), ("联网查离线学习的最新进展", True),
    ("Don't only use my notes; search the web for official docs.", True),
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


def test_restricted_question_uses_local_handlers(monkeypatch):
    def unexpected_search(*args, **kwargs):
        pytest.fail("A restricted question reached public search")
    monkeypatch.setattr(web_search, "search", unexpected_search)
    monkeypatch.setattr(learning_api.loop, "chat_with_course", lambda *a, **kw: ("课堂原文", [], []))
    question = "仅参考我的讲义，找出最新研究的参考资料"
    assert learning_api.search_if_requested({"question": question}, "/api") == ({"success": True, "source": "local"}, 200)
    reply, status = learning_api.chat({"course_id": "fixture", "question": question}, "/api")
    assert status == 200 and reply["source"] == "course" and reply["answer"] == "课堂原文"


def test_search_failure(monkeypatch):
    def unavailable(_): raise web_search.requests.Timeout()
    monkeypatch.setattr(web_search, "search", unavailable)
    assert web_search.web_reply("official docs")[1] == 503
    assert web_search._url("javascript:void(0)") is None
    assert web_search._url("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fa%0Ab") is None

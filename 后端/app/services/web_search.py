"""Choose a source for a study question and return attributable public search results."""
import os
import re
from urllib.parse import parse_qs, urlsplit

import requests
from bs4 import BeautifulSoup
from app.services import grounded

LOCAL_ONLY = re.compile(r"(?:不要|不用|无需|禁止|别)(?:再)?(?:联网|上网|搜网)|只(?:根据|看|用|参考)(?:这|本)?(?:段|个|篇)?(?:视频|文档|课程)|without (?:web|internet)|do not (?:browse|search)", re.I)
EXPLICIT_WEB = re.compile(r"联网|上网|网上|全网|课外|延伸阅读|拓展阅读|官方文档|官方网站|参考资料|相关资料|推荐.{0,12}(?:资料|书籍|论文|教程)|(?:找|搜|查).{0,16}(?:论文|链接|资料|教程)|search (?:the )?web|official docs|further reading", re.I)
LOCAL_REFERENCE = re.compile(r"视频|课上|课程里|老师|讲者|课件|字幕|原片|幻灯片|文中|原文|这篇|这段|本文|笔记里|第.{1,6}(?:章|节|分钟|页)|\b\d{1,2}:\d{2}\b|in (?:the|this) (?:video|lecture|document)", re.I)
CURRENT = re.compile(r"最新|现任|现价|近期|今年|最近.{0,10}(?:进展|发布|更新|研究)|当前版本|哪(?:里|儿)下载|latest|current release|release notes", re.I)


def needs_web(question):
    if LOCAL_ONLY.search(question):
        return False
    if re.search(r"联网|上网|全网|search the web", question, re.I):
        return True
    if LOCAL_REFERENCE.search(question):
        return False
    if EXPLICIT_WEB.search(question):
        return True
    return bool(CURRENT.search(question))


def _url(raw):
    if not isinstance(raw, str) or any(c.isspace() or ord(c) < 32 for c in raw) or "\\" in raw:
        return None
    try:
        u = urlsplit(raw)
        if u.hostname in {"duckduckgo.com", "www.duckduckgo.com"} and u.path == "/l/":
            raw = parse_qs(u.query).get("uddg", [""])[0]
            u = urlsplit(raw)
        if u.scheme in {"https", "http"} and u.hostname and not (u.username or u.password) and len(raw) <= 2048:
            return raw
    except ValueError:
        pass
    return None


def _query(question):
    q = re.sub(r"^(?:(?:请|麻烦|帮我|给我|一下|搜一下|搜索|查一下|找一下|查找|联网|上网|搜搜|搜)[\s，,:：]*)+", "", question.strip())
    return (q or question.strip())[:240]


def search(question):
    query = _query(question)
    key = os.getenv("BRAVE_SEARCH_API_KEY", "").strip()
    headers = {"User-Agent": "VideoParse/1.0 (public resource search)"}
    if key:
        response = requests.get("https://api.search.brave.com/res/v1/web/search",
                                params={"q": query, "count": 5}, headers={**headers, "X-Subscription-Token": key},
                                timeout=(3, 8), allow_redirects=False)
        response.raise_for_status()
        rows = [(item.get("title"), item.get("url"), item.get("description"))
                for item in response.json().get("web", {}).get("results", [])]
    else:
        response = requests.get("https://html.duckduckgo.com/html/", params={"q": query}, headers=headers,
                                timeout=(3, 8))
        response.raise_for_status()
        page = BeautifulSoup(response.content, "html.parser")
        rows = []
        for result in page.select(".result:not(.result--ad)"):
            anchor, excerpt = result.select_one("a.result__a"), result.select_one(".result__snippet")
            if anchor and excerpt:
                rows.append((anchor.get_text(" ", strip=True), anchor.get("href"), excerpt.get_text(" ", strip=True)))
        if not rows and not page.select_one(".no-results, .result--no-result"):
            raise ValueError("Search provider returned no usable result page")

    sources, seen = [], set()
    for title, raw, snippet in rows:
        url = _url(raw)
        if not url or url in seen or not title or not snippet:
            continue
        seen.add(url)
        sources.append({"title": BeautifulSoup(title, "html.parser").get_text(" ", strip=True)[:180], "url": url,
                        "snippet": BeautifulSoup(snippet, "html.parser").get_text(" ", strip=True)[:450]})
        if len(sources) == 5:
            break
    return sources


def web_reply(question, history=()):
    try:
        sources = search(question)
    except (requests.RequestException, ValueError, KeyError, TypeError):
        return {"success": False, "source": "web", "error": "联网搜索暂时不可用，请稍后重试。"}, 503
    answer = "以下是与问题相关的网页资料。" if sources else "没有找到相关网页，可以换一个关键词再试。"
    if sources:
        claims = grounded.claims(question, [s["snippet"] for s in sources])
        answer = "\n".join(f'{c["answer"]} [{c["id"]}]' for c in claims) if claims else "网页摘要 · " + sources[0]["snippet"] + " [1]"
    return {"success": True, "source": "web", "answer": answer, "web_sources": sources, "citations": [],
            "tools_used": ["web_search"], "history": [*history, {"role": "user", "content": question},
                                                     {"role": "assistant", "content": answer}]}, 200

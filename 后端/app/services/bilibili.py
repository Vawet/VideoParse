"""Read public Bilibili video pages, bounded progressive streams and public comment samples."""
import json
import re
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

VIDEO_HOSTS = {"www.bilibili.com", "m.bilibili.com", "bilibili.com"}
CDNS = ("bilivideo.com", "bilivideo.cn")
MAX_MEDIA = 2 * 1024**3


class SourceError(ValueError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _open(url, referer=None):
    headers = {"User-Agent": "VideoParse/1.0"}
    if referer:
        headers["Referer"] = referer
    return build_opener(NoRedirect).open(Request(url, headers=headers), timeout=15)


def _parts(url):
    try:
        p = urlsplit(url.strip())
        if (p.scheme not in ("https", "http") or not p.hostname or p.username is not None
                or p.password is not None or p.port is not None):
            raise ValueError()
    except ValueError:
        raise SourceError("请输入有效的 B 站视频链接") from None
    return p


def identify(url):
    p = _parts(url)
    if p.hostname == "b23.tv" and re.fullmatch(r"/[A-Za-z0-9]+/?", p.path):
        try:
            with _open("https://b23.tv" + p.path):
                raise SourceError("短链接未指向视频，请粘贴完整视频地址")
        except HTTPError as e:
            with e:
                if e.code not in (301, 302, 303, 307, 308):
                    raise SourceError("短链接暂不可用，请粘贴完整视频地址") from None
                p = _parts(urljoin("https://b23.tv", e.headers.get("Location", "")))
    match = re.fullmatch(r"/video/(BV[A-Za-z0-9]{10}|av[0-9]{1,18})/?", p.path)
    if p.hostname not in VIDEO_HOSTS or not match:
        raise SourceError("支持 bilibili.com/video 视频页及 b23.tv 视频短链接")
    page = parse_qs(p.query).get("p", ["1"])[0]
    if not re.fullmatch(r"[1-9][0-9]{0,3}", page):
        raise SourceError("无效的分 P 编号")
    return match.group(1), int(page)


def _api(path, **params):
    with _open("https://api.bilibili.com/x/" + path + "?" + urlencode(params)) as r:
        data = r.read(2 * 1024**2 + 1)
    if len(data) > 2 * 1024**2:
        raise SourceError("B 站响应过大")
    try:
        result = json.loads(data)
    except ValueError:
        raise SourceError("B 站暂未返回公开数据，请稍后重试") from None
    if result.get("code") != 0 or not isinstance(result.get("data"), dict):
        raise SourceError("B 站暂未提供此内容，可能需要登录、内容已关闭或请求受限")
    return result["data"]


def _media_url(raw):
    p = _parts(raw)
    if not any(p.hostname == host or p.hostname.endswith("." + host) for host in CDNS):
        raise SourceError("没有可用的 B 站官方媒体地址")
    return urlunsplit(("https", p.hostname, p.path, p.query, ""))


def download(url, target):
    key, page = identify(url)
    meta = _api("web-interface/view", **({"bvid": key} if key.startswith("BV") else {"aid": key[2:]}))
    part = next((p for p in meta["pages"] if p["page"] == page), None)
    if not part:
        raise SourceError("视频没有该分 P")
    bv = meta["bvid"]
    info = _api("player/playurl", bvid=bv, cid=part["cid"], fnval=1, qn=32)
    streams = info.get("durl") or []
    if len(streams) != 1:
        raise SourceError("该视频暂未提供可直接导入的公开音视频流")
    item = streams[0]
    size = item.get("size", 0)
    if not 0 < size <= MAX_MEDIA:
        raise SourceError("视频大小未知或超过 2 GiB 上限")
    page_url = "https://www.bilibili.com/video/" + bv + "/"
    deadline = time.monotonic() + 145
    for raw in (item["url"], *(item.get("backup_url") or [])):
        try:
            media = _media_url(raw)
            with _open(media, page_url) as source, open(target, "wb") as output:
                total = 0
                while True:
                    if time.monotonic() > deadline:
                        raise SourceError("视频下载超时，请稍后重试")
                    block = source.read(512 * 1024)
                    if not block:
                        break
                    if total == 0 and not (block[4:8] == b"ftyp" or block[:3] == b"FLV"):
                        raise SourceError("B 站未返回有效媒体文件")
                    if total == 0:
                        extension = "flv" if block[:3] == b"FLV" else "mp4"
                    total += len(block)
                    if total > size:
                        raise SourceError("视频大小与平台声明不符")
                    output.write(block)
                if total == size:
                    title = meta["title"] + (" · " + part["part"] if len(meta["pages"]) > 1 else "")
                    return {"title": title, "extension": extension, "aid": meta["aid"], "bvid": bv, "page": page}
        except (OSError, SourceError):
            if time.monotonic() >= deadline:
                break
    raise SourceError("未能下载完整的公开媒体，请稍后重试")


def comments(aid):
    data = _api("v2/reply", type=1, oid=int(aid), sort=2, ps=20, pn=1)
    rows = []
    for reply in (data.get("replies") or [])[:20]:
        text = (reply.get("content") or {}).get("message", "").strip()
        if text and reply.get("rpid"):
            rows.append({"id": str(reply["rpid"]), "text": text[:600]})
    return rows

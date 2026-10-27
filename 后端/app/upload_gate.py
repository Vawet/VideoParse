"""上传口令：上传前必须先回答问题，答对才发一次性令牌；上传接口必须带有效令牌。
问题/答案可用环境变量 UPLOAD_QUESTION / UPLOAD_ANSWER 覆盖；UPLOAD_ANSWER 设为空字符串则关闭此门禁。"""
import hmac
import os
import secrets
import threading
import time

TOKEN_TTL = 600        # 令牌有效期(秒)
MAX_FAILS = 5          # 窗口内最多答错次数
FAIL_WINDOW = 600      # 统计窗口(秒)

_lock = threading.Lock()
_tokens = {}           # token -> 过期时间
_fails = {}            # ip -> [失败时间戳...]


def question() -> str:
    return os.getenv("UPLOAD_QUESTION", "我的名字是什么？")


def _answer() -> str:
    return os.getenv("UPLOAD_ANSWER", "陆鑫")


def enabled() -> bool:
    return bool(_answer())


def _norm(s: str) -> str:
    return "".join((s or "").split()).casefold()


def _recent_fails(ip: str, now: float) -> list:
    fails = [t for t in _fails.get(ip, []) if now - t < FAIL_WINDOW]
    _fails[ip] = fails
    return fails


def verify(answer: str, ip: str):
    """返回 (token|None, error|None)。"""
    if not enabled():
        return "disabled", None
    now = time.time()
    with _lock:
        if len(_recent_fails(ip, now)) >= MAX_FAILS:
            return None, "答错次数过多，请稍后再试"
        if hmac.compare_digest(_norm(answer).encode(), _norm(_answer()).encode()):
            _fails.pop(ip, None)
            for t in [t for t, exp in _tokens.items() if exp < now]:
                _tokens.pop(t, None)
            token = secrets.token_urlsafe(24)
            _tokens[token] = now + TOKEN_TTL
            return token, None
        _fails[ip].append(now)
        return None, "回答不正确"


def consume(token: str) -> bool:
    """校验并作废令牌（一次性）。"""
    if not enabled():
        return True
    with _lock:
        exp = _tokens.pop(token or "", 0)
    return exp > time.time()

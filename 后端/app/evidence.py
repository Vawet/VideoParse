"""证据层：所有"结论"都要附 (video_id, 时间戳, 原文引用)，并由代码校验引用真实存在于字幕中。

这是对付大模型幻觉最可靠的办法：模型可以编造引用，但编造的引用在字幕里找不到，就会被拒绝。
"""
import re
import unicodedata
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from typing import List, Optional

MIN_QUOTE_CHARS = 4      # 过短的引用没有校验意义（如"的"、"是"）
DEFAULT_WINDOW = 15.0    # 声称的时间戳前后允许的偏差（秒）
DEFAULT_THRESHOLD = 0.85
_PUNCT = re.compile(r"[\s\u3000，。！？、；：“”‘’（）《》【】—…·,.!?;:\"'()\[\]{}<>\-_/\\|*~`]+")


@dataclass
class Evidence:
    video_id: str
    start: float
    end: float
    quote: str

    def to_dict(self):
        return asdict(self)


@dataclass
class VerifyResult:
    ok: bool
    score: float = 0.0
    start: Optional[float] = None   # 校正后的真实起点（匹配到的字幕片段起点）
    end: Optional[float] = None
    reason: str = ""


def normalize(text: str) -> str:
    """NFKC + 去标点空白 + 小写，使"Transformer，是"与"transformer 是"可比较。"""
    return _PUNCT.sub("", unicodedata.normalize("NFKC", text or "")).lower()


def _build_haystack(segments: List[dict], lo: Optional[float], hi: Optional[float]):
    """把窗口内的字幕拼成归一化字符串，并记录每个字符属于哪个片段。"""
    chars, owner = [], []
    for i, seg in enumerate(segments):
        if lo is not None and (seg["end_time"] < lo or seg["start_time"] > hi):
            continue
        norm = normalize(seg["text"])
        chars.append(norm)
        owner.extend([i] * len(norm))
    return "".join(chars), owner


def _best_match(hay: str, needle: str):
    """返回 (相似度, 起始下标)。先精确子串，再用滑窗近似匹配（容忍 ASR 个别字差异）。"""
    pos = hay.find(needle)
    if pos >= 0:
        return 1.0, pos
    if len(hay) < len(needle) * 0.6:
        return 0.0, -1
    best, best_pos = 0.0, -1
    m = len(needle)
    step = 1 if len(hay) <= 2000 else 2
    sm = SequenceMatcher(autojunk=False)
    sm.set_seq2(needle)
    for i in range(0, max(1, len(hay) - m + 1), step):
        sm.set_seq1(hay[i:i + m])
        if sm.real_quick_ratio() < best:
            continue
        r = sm.ratio()
        if r > best:
            best, best_pos = r, i
            if r >= 0.999:
                break
    return best, best_pos


def verify_quote(segments: List[dict], start: Optional[float], quote: str,
                 window: float = DEFAULT_WINDOW, threshold: float = DEFAULT_THRESHOLD) -> VerifyResult:
    """校验 quote 是否出现在 start 附近(±window 秒)的字幕里；start 为 None 时在全部字幕里找。"""
    needle = normalize(quote)
    if len(needle) < MIN_QUOTE_CHARS:
        return VerifyResult(False, reason=f"引用过短(<{MIN_QUOTE_CHARS}字)，无法校验")
    if not segments:
        return VerifyResult(False, reason="没有字幕可供校验")

    lo = hi = None
    if start is not None:
        lo, hi = start - window, start + window
    hay, owner = _build_haystack(segments, lo, hi)
    if not hay:
        return VerifyResult(False, reason="声称的时间点附近没有字幕")

    score, pos = _best_match(hay, needle)
    if pos < 0 or score < threshold:
        return VerifyResult(False, score=round(score, 3), reason="字幕中找不到该引用")
    first = segments[owner[pos]]
    last = segments[owner[min(pos + len(needle) - 1, len(owner) - 1)]]
    return VerifyResult(True, round(score, 3), first["start_time"], last["end_time"])


def verify_evidence_list(segments: List[dict], evidence: List[dict]) -> List[dict]:
    """校验一组证据，返回通过校验并已校正时间戳的证据；全部不通过则返回空列表。"""
    ok = []
    for ev in evidence or []:
        r = verify_quote(segments, ev.get("start"), ev.get("quote", ""))
        if r.ok:
            ok.append({**ev, "start": r.start, "end": r.end, "score": r.score})
    return ok

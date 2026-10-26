"""检索层：Retriever 抽象 + BM25(jieba 分词) 实现。以后换向量/混合检索只需新增一个子类。"""
import logging
import re
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from typing import Dict, List, Tuple

import jieba
from rank_bm25 import BM25Okapi

from app.db import repo
from app.services import media

jieba.setLogLevel(logging.WARNING)
_PUNCT = re.compile(r"^[\W_]+$")
_STOP = {"的", "了", "是", "在", "和", "与", "及", "就", "都", "也", "有", "我", "你", "他", "这", "那", "一个", "什么", "怎么", "吗", "呢", "啊"}


def tokenize(text: str) -> List[str]:
    toks = [t.strip().lower() for t in jieba.lcut_for_search(text or "")]
    return [t for t in toks if t and not _PUNCT.match(t) and t not in _STOP]


@dataclass
class Hit:
    video_id: str
    video_title: str
    start: float
    end: float
    text: str
    context: str
    score: float

    def to_dict(self) -> dict:
        d = asdict(self)
        d["time"] = media.seconds_to_hhmmss(self.start)
        d["score"] = round(self.score, 3)
        return d


class Retriever(ABC):
    @abstractmethod
    def search(self, query: str, top_k: int = 5) -> List[Hit]:
        ...


class Bm25Retriever(Retriever):
    """chunks: repo.course_transcripts 的格式 {video_id, video_title, start, end, text}，需按视频、时间有序。"""

    def __init__(self, chunks: List[dict]):
        self.chunks = chunks
        self.docs = [tokenize(c["text"]) for c in chunks]
        self.index = BM25Okapi(self.docs) if any(self.docs) else None

    def search(self, query: str, top_k: int = 5) -> List[Hit]:
        qtoks = [t for t in dict.fromkeys(tokenize(query))]
        if not self.index or not qtoks:
            return []
        scores = self.index.get_scores(qtoks)
        ranked = []
        for i, doc in enumerate(self.docs):
            overlap = len(set(qtoks) & set(doc))
            if overlap:  # 小语料里 BM25 的 idf 可能为 0，所以用"有词命中"做准入，分数/命中数做排序
                ranked.append((scores[i], overlap, -i, i))
        ranked.sort(reverse=True)
        return [self._hit(i, sc) for sc, _, _, i in ranked[:max(1, int(top_k))]]

    def _hit(self, i: int, score: float) -> Hit:
        c = self.chunks[i]
        near = [self.chunks[j]["text"] for j in (i - 1, i, i + 1)
                if 0 <= j < len(self.chunks) and self.chunks[j]["video_id"] == c["video_id"]]
        return Hit(c["video_id"], c["video_title"], c["start"], c["end"], c["text"], " ".join(near), float(score))


# ------------------------------------------------------------------ 缓存（按课程）
_cache: Dict[str, Tuple[tuple, Bm25Retriever]] = {}


def _signature(chunks: List[dict]) -> tuple:
    return (len(chunks), sum(len(c["text"]) for c in chunks), tuple(sorted({c["video_id"] for c in chunks})))


def invalidate(key: str = None):
    """课程新增视频/视频重新解析后调用；不传则清空全部。"""
    if key is None:
        _cache.clear()
    else:
        _cache.pop(key, None)


def _cached(key: str, chunks: List[dict]) -> Bm25Retriever:
    sig = _signature(chunks)
    hit = _cache.get(key)
    if hit and hit[0] == sig:
        return hit[1]
    r = Bm25Retriever(chunks)
    _cache[key] = (sig, r)
    return r


def for_course(course_id: str) -> Retriever:
    return _cached("course:" + course_id, repo.course_transcripts(course_id))


def for_video(video_id: str) -> Retriever:
    v = repo.get_video(video_id) or {}
    title = v.get("title") or video_id[:8]
    chunks = [{"video_id": video_id, "video_title": title, "start": s["start_time"], "end": s["end_time"],
               "text": s["text"]} for s in repo.get_transcript(video_id)]
    return _cached("video:" + video_id, chunks)

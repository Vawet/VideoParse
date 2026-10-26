"""检索层：Retriever 抽象 + BM25(jieba 分词) 实现。以后换向量/混合检索只需新增一个子类。"""
import logging
import os
import re
import threading
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from typing import Dict, List, Tuple

import jieba
from rank_bm25 import BM25Okapi

from app.db import repo
from app.services import media

log = logging.getLogger(__name__)
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

    def ranked(self, query: str) -> List[Tuple[int, float]]:
        qtoks = [t for t in dict.fromkeys(tokenize(query))]
        if not self.index or not qtoks:
            return []
        scores = self.index.get_scores(qtoks)
        out = []
        for i, doc in enumerate(self.docs):
            overlap = len(set(qtoks) & set(doc))
            if overlap:  # 小语料里 BM25 的 idf 可能为 0，所以用"有词命中"做准入，分数/命中数做排序
                out.append((scores[i], overlap, -i, i))
        out.sort(reverse=True)
        return [(i, float(sc)) for sc, _, _, i in out]

    def search(self, query: str, top_k: int = 5) -> List[Hit]:
        return [_make_hit(self.chunks, i, sc) for i, sc in self.ranked(query)[:max(1, int(top_k))]]


_QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章："
_embedder = None
_embedder_lock = threading.Lock()


def _get_embedder():
    """懒加载本地 embedding 模型；失败返回 None（调用方降级为纯 BM25）。"""
    global _embedder
    with _embedder_lock:
        if _embedder is None:
            try:
                from sentence_transformers import SentenceTransformer
                _embedder = SentenceTransformer(os.getenv("EMBED_MODEL", "BAAI/bge-small-zh-v1.5"))
            except Exception as e:  # noqa: BLE001
                log.warning("embedding 模型不可用，降级为 BM25: %s", e)
                _embedder = False
    return _embedder or None


class DenseRetriever(Retriever):
    """语义检索：本地 embedding + 余弦相似度。chunks 格式同 Bm25Retriever。"""

    def __init__(self, chunks: List[dict], embedder=None):
        self.chunks = chunks
        self.embedder = embedder or _get_embedder()
        self.vecs = None
        if self.embedder and chunks:
            self.vecs = self.embedder.encode([c["text"] for c in chunks], normalize_embeddings=True, show_progress_bar=False)

    def ranked(self, query: str) -> List[Tuple[int, float]]:
        if self.vecs is None or not (query or "").strip():
            return []
        q = self.embedder.encode([_QUERY_PREFIX + query], normalize_embeddings=True, show_progress_bar=False)[0]
        sims = self.vecs @ q
        return sorted(((i, float(sims[i])) for i in range(len(sims))), key=lambda t: -t[1])

    def search(self, query: str, top_k: int = 5) -> List[Hit]:
        return [_make_hit(self.chunks, i, sc) for i, sc in self.ranked(query)[:max(1, int(top_k))]]


class HybridRetriever(Retriever):
    """BM25 + 向量，用 RRF（倒数排名融合）合并；向量不可用时等价于 BM25。"""

    def __init__(self, chunks: List[dict], embedder=None, rrf_k: int = 60, pool: int = 10):
        self.chunks, self.rrf_k, self.pool = chunks, rrf_k, pool
        self.bm25 = Bm25Retriever(chunks)
        self.dense = DenseRetriever(chunks, embedder)

    def search(self, query: str, top_k: int = 5) -> List[Hit]:
        top_k = max(1, int(top_k))
        if self.dense.vecs is None:
            return self.bm25.search(query, top_k)
        fused: Dict[int, float] = {}
        for rank, (i, _) in enumerate(self.bm25.ranked(query)[:self.pool]):
            fused[i] = fused.get(i, 0) + 1 / (self.rrf_k + rank)
        for rank, (i, _) in enumerate(self.dense.ranked(query)[:self.pool]):
            fused[i] = fused.get(i, 0) + 1 / (self.rrf_k + rank)
        order = sorted(fused.items(), key=lambda t: (-t[1], t[0]))[:top_k]
        return [_make_hit(self.chunks, i, sc) for i, sc in order]


def _make_hit(chunks: List[dict], i: int, score: float) -> Hit:
    c = chunks[i]
    near = [chunks[j]["text"] for j in (i - 1, i, i + 1)
            if 0 <= j < len(chunks) and chunks[j]["video_id"] == c["video_id"]]
    return Hit(c["video_id"], c["video_title"], c["start"], c["end"], c["text"], " ".join(near), float(score))


def _make(chunks: List[dict]) -> Retriever:
    """RETRIEVER=bm25 (默认) | hybrid"""
    return HybridRetriever(chunks) if os.getenv("RETRIEVER", "bm25").lower() == "hybrid" else Bm25Retriever(chunks)


# ------------------------------------------------------------------ 缓存（按课程）
_cache: Dict[str, Tuple[tuple, Retriever]] = {}


def _signature(chunks: List[dict]) -> tuple:
    return (len(chunks), sum(len(c["text"]) for c in chunks), tuple(sorted({c["video_id"] for c in chunks})))


def invalidate(key: str = None):
    """课程新增视频/视频重新解析后调用；不传则清空全部。"""
    if key is None:
        _cache.clear()
    else:
        _cache.pop(key, None)


def _cached(key: str, chunks: List[dict]) -> Retriever:
    sig = _signature(chunks)
    hit = _cache.get(key)
    if hit and hit[0] == sig:
        return hit[1]
    r = _make(chunks)
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

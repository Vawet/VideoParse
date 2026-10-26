"""混合检索：用假 embedder 离线验证 RRF 融合与降级，不下载模型。"""
import numpy as np

from app import retrieval
from app.retrieval import Bm25Retriever, DenseRetriever, HybridRetriever

CHUNKS = [
    {"video_id": "v", "video_title": "t", "start": 0, "end": 10, "text": "今天讲梯度下降法"},
    {"video_id": "v", "video_title": "t", "start": 10, "end": 20, "text": "位置编码用来表示顺序"},
    {"video_id": "v", "video_title": "t", "start": 20, "end": 30, "text": "卷积层提取局部特征"},
]


class FakeEmbedder:
    """按"概念"手工构造向量：顺序/先后 与 位置编码 同一维度，字面上没有共同词。"""
    CONCEPTS = [("梯度", "损失"), ("位置", "顺序", "先后", "次序"), ("卷积", "局部")]

    def encode(self, texts, **kw):
        out = []
        for t in texts:
            v = np.array([float(any(k in t for k in grp)) for grp in self.CONCEPTS]) + 1e-3
            out.append(v / np.linalg.norm(v))
        return np.array(out)


def test_dense_finds_paraphrase_that_bm25_misses():
    q = "模型怎么知道词的先后次序"
    assert Bm25Retriever(CHUNKS).search(q, 1) == [] or Bm25Retriever(CHUNKS).search(q, 1)[0].start != 10
    assert DenseRetriever(CHUNKS, FakeEmbedder()).search(q, 1)[0].start == 10


def test_hybrid_keeps_literal_and_adds_semantic():
    h = HybridRetriever(CHUNKS, FakeEmbedder())
    assert h.search("梯度下降", 1)[0].start == 0
    assert h.search("词的先后次序", 1)[0].start == 10


def test_hybrid_degrades_to_bm25_without_embedder(monkeypatch):
    monkeypatch.setattr(retrieval, "_get_embedder", lambda: None)
    h = HybridRetriever(CHUNKS)
    assert h.dense.vecs is None
    assert h.search("卷积", 1)[0].start == 20


def test_factory_switch(monkeypatch):
    monkeypatch.setenv("RETRIEVER", "hybrid")
    monkeypatch.setattr(retrieval, "_get_embedder", lambda: None)
    assert isinstance(retrieval._make(CHUNKS), HybridRetriever)
    monkeypatch.setenv("RETRIEVER", "bm25")
    assert isinstance(retrieval._make(CHUNKS), Bm25Retriever)

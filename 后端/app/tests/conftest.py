"""共享夹具：隔离的临时目录 + 临时数据库 + 一个已有字幕的视频工作区。"""
import types

import pytest

from app import config

SEGMENTS = [
    {"start_time": 0.0, "end_time": 10.0, "text": "大家好，今天我们来讲一下Transformer模型。"},
    {"start_time": 10.0, "end_time": 30.0, "text": "自注意力机制中，每个词会生成查询、键和值三个向量。"},
    {"start_time": 30.0, "end_time": 50.0, "text": "通过查询和键的点积计算注意力权重，再对值做加权求和。"},
    {"start_time": 50.0, "end_time": 70.0, "text": "Transformer的优势是可以并行计算，训练速度快。"},
]


@pytest.fixture
def learn_env(tmp_path, monkeypatch):
    from app.agent.state import Workspace
    from app.db import repo, session

    for attr in ("UPLOAD_FOLDER", "FRAMES_FOLDER", "AUDIO_FOLDER", "OUTPUT_FOLDER"):
        d = tmp_path / attr
        d.mkdir()
        monkeypatch.setattr(config, attr, str(d))
    monkeypatch.setattr(config, "DATABASE_URL", f"sqlite:///{tmp_path}/learn.db")
    session.reset_engine()

    ws = Workspace("vid-learn")
    ws.save("transcript", {"segments": SEGMENTS, "text": "".join(s["text"] for s in SEGMENTS)})
    ws.update_meta(duration=70.0, has_audio=True)
    repo.index_video("vid-learn", SEGMENTS, 70.0)
    yield types.SimpleNamespace(ws=ws, segments=SEGMENTS, tmp=tmp_path)
    session.reset_engine()


@pytest.fixture(autouse=True)
def _offline_retriever(monkeypatch):
    """离线测试固定走 BM25，避免加载真实 embedding 模型；混合检索见 test_hybrid.py。"""
    monkeypatch.setenv("RETRIEVER", "bm25")

from app import retrieval
from app.db import repo

A = [{"start_time": 0, "end_time": 10, "text": "今天讲梯度下降算法，沿着损失函数的负梯度方向更新参数。"},
     {"start_time": 10, "end_time": 20, "text": "学习率太大会导致震荡不收敛。"},
     {"start_time": 20, "end_time": 30, "text": "最后总结一下这一节的内容。"}]
B = [{"start_time": 0, "end_time": 15, "text": "反向传播利用链式法则计算每一层的梯度。"},
     {"start_time": 15, "end_time": 30, "text": "卷积神经网络用于图像识别。"}]


def test_tokenize_chinese_drops_stopwords_and_punct():
    toks = retrieval.tokenize("学习率是什么？")
    assert "学习" in toks and "是" not in toks and "？" not in toks


def test_course_search_across_videos_with_sources(learn_env):
    retrieval.invalidate()
    repo.register_video("va", "梯度下降")
    repo.register_video("vb", "反向传播")
    repo.index_video("va", A)
    repo.index_video("vb", B)
    c = repo.create_course("机器学习")
    repo.add_video_to_course(c["id"], "va")
    repo.add_video_to_course(c["id"], "vb")

    hits = retrieval.for_course(c["id"]).search("链式法则")
    assert hits[0].video_id == "vb" and hits[0].video_title == "反向传播" and hits[0].start == 0
    hits = retrieval.for_course(c["id"]).search("梯度", top_k=5)
    assert {h.video_id for h in hits} == {"va", "vb"}          # 跨视频都能命中
    assert "学习率" in retrieval.for_course(c["id"]).search("学习率太大")[0].context
    assert retrieval.for_course(c["id"]).search("区块链") == []
    assert hits[0].to_dict()["time"].count(":") == 2


def test_cache_reuses_index_and_invalidates_on_new_video(learn_env):
    retrieval.invalidate()
    repo.register_video("va", "a")
    repo.index_video("va", A)
    c = repo.create_course("课")
    repo.add_video_to_course(c["id"], "va")
    r1 = retrieval.for_course(c["id"])
    assert retrieval.for_course(c["id"]) is r1
    assert retrieval.for_course(c["id"]).search("链式法则") == []

    repo.register_video("vb", "b")
    repo.index_video("vb", B)
    repo.add_video_to_course(c["id"], "vb")
    r2 = retrieval.for_course(c["id"])
    assert r2 is not r1 and r2.search("链式法则")[0].video_id == "vb"


def test_single_video_retriever(learn_env):
    retrieval.invalidate()
    hits = retrieval.for_video("vid-learn").search("三个向量")
    assert hits and hits[0].start == 10.0

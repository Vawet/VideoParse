from app.services.keywords import extract_keywords

SEGS = [
    {"start_time": 0, "end_time": 8, "text": "今天我们来讲Transformer模型的自注意力机制。"},
    {"start_time": 8, "end_time": 20, "text": "自注意力机制会为每个词生成查询、键、值三个向量。"},
    {"start_time": 20, "end_time": 30, "text": "通过点积计算注意力权重，再做加权求和。"},
    {"start_time": 30, "end_time": 40, "text": "Transformer可以并行计算，训练速度比循环神经网络快。"},
]


def test_extracts_domain_terms_with_times():
    kws = extract_keywords(SEGS, 8)
    words = [k["word"] for k in kws]
    assert any("注意力" in w for w in words) and "Transformer" in words
    tr = next(k for k in kws if k["word"] == "Transformer")
    assert tr["times"] == [0.0, 30.0] and tr["first_time"] == "00:00:00" and tr["count"] == 2
    assert not {"今天", "我们", "大家"} & set(words)
    assert kws == sorted(kws, key=lambda k: -k["weight"])


def test_empty_and_limit():
    assert extract_keywords([]) == []
    assert extract_keywords([{"start_time": 0, "end_time": 1, "text": "  "}]) == []
    assert len(extract_keywords(SEGS, 3)) <= 3

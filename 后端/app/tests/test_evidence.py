"""证据层测试：引用校验必须拒绝编造、放行真实引用（含标点/个别 ASR 错字）。"""
from app import evidence as ev

SEGS = [
    {"start_time": 0.0, "end_time": 10.0, "text": "大家好，今天我们来讲一下Transformer模型。"},
    {"start_time": 10.0, "end_time": 30.0, "text": "每个词会生成查询、键和值三个向量。"},
    {"start_time": 100.0, "end_time": 120.0, "text": "最后总结一下，Transformer可以并行计算。"},
]


def test_exact_quote_ignores_punctuation_and_case_and_corrects_start():
    r = ev.verify_quote(SEGS, start=12, quote="生成查询 键和值三个向量")
    assert r.ok and r.score == 1.0 and (r.start, r.end) == (10.0, 30.0)
    assert ev.verify_quote(SEGS, 5, "transformer模型").ok


def test_tolerates_small_asr_difference():
    # 字幕是"查询、键和值"，引用写成"查寻、键和值"（一字之差）
    r = ev.verify_quote(SEGS, 12, "每个词会生成查寻键和值三个向量")
    assert r.ok and 0.85 <= r.score < 1.0


def test_fabricated_quote_is_rejected():
    r = ev.verify_quote(SEGS, 12, "反向传播算法用于更新权重参数")
    assert not r.ok and "找不到" in r.reason


def test_right_text_but_wrong_time_is_rejected():
    # "最后总结一下"在 100 秒处，声称在 12 秒 -> 窗口(±15s)内没有，应拒绝
    assert not ev.verify_quote(SEGS, 12, "最后总结一下Transformer可以并行计算").ok
    # 不给时间点时全文检索则通过，且时间戳被校正为真实位置
    r = ev.verify_quote(SEGS, None, "最后总结一下Transformer可以并行计算")
    assert r.ok and r.start == 100.0


def test_too_short_or_empty_inputs_are_rejected():
    assert not ev.verify_quote(SEGS, 5, "的").ok
    assert not ev.verify_quote([], 5, "今天我们来讲一下").ok
    assert not ev.verify_quote(SEGS, 5000, "今天我们来讲一下").ok  # 该时间点附近没有字幕


def test_verify_evidence_list_filters_and_corrects():
    good = {"video_id": "v", "start": 11, "end": 12, "quote": "生成查询键和值三个向量"}
    bad = {"video_id": "v", "start": 11, "end": 12, "quote": "完全编造的一句话内容"}
    out = ev.verify_evidence_list(SEGS, [good, bad])
    assert len(out) == 1 and out[0]["start"] == 10.0 and out[0]["end"] == 30.0

from app.services.asr import split_segment


def _words(text, step=0.5):
    return [{"word": c, "start": i * step, "end": (i + 1) * step} for i, c in enumerate(text)]


def test_split_on_sentence_end():
    segs = split_segment({"start": 0, "end": 6, "text": "x", "words": _words("今天讲函数。它很重要。")})
    assert [s["text"] for s in segs] == ["今天讲函数。", "它很重要。"]
    assert segs[1]["start_time"] == 3.0


def test_long_sentence_breaks_at_comma_not_mid_word():
    text = "谷歌提出的网络结构，它完全基于注意力机制抛弃了循环神经网络"
    segs = split_segment({"start": 0, "end": 99, "text": "x", "words": _words(text)}, max_sec=8)
    assert segs[0]["text"].endswith("，")
    assert "".join(s["text"] for s in segs) == text


def test_no_words_falls_back_to_whole_segment():
    assert split_segment({"start": 1, "end": 5, "text": " 你好 "}) == [{"start_time": 1, "end_time": 5, "text": "你好"}]

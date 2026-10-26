"""文本工具：简易分词（单视频内的关键词检索与上下文选择使用）。"""
import re
from typing import List


def tokens(q: str) -> set:
    q = q.lower()
    words = re.findall(r"[a-z0-9]+", q)
    cjk = "".join(re.findall(r"[\u4e00-\u9fff]", q))
    grams = [cjk[i:i + 2] for i in range(len(cjk) - 1)] or list(cjk)
    return set(words + grams)


def select_context(segments: List[dict], topic: str = "", max_chars: int = 9000, radius: int = 1) -> List[dict]:
    """挑出送给 LLM 的字幕：有主题时取最相关片段及其前后文，无主题时均匀覆盖全片；按时间顺序返回。"""
    if not segments:
        return []
    total = sum(len(s["text"]) for s in segments)
    if topic.strip():
        toks = tokens(topic)
        scored = sorted(((sum(1 for t in toks if t in s["text"].lower()), i) for i, s in enumerate(segments)),
                        key=lambda x: (-x[0], x[1]))
        picked = set()
        used = 0
        for score, i in scored:
            if score == 0 or used >= max_chars:
                break
            for j in range(max(0, i - radius), min(len(segments), i + radius + 1)):
                if j not in picked:
                    picked.add(j)
                    used += len(segments[j]["text"])
        if picked:
            return [segments[i] for i in sorted(picked)]
        # 主题在字幕里完全找不到：返回空，让上层如实告知，而不是随便拿别的内容出题
        return []
    if total <= max_chars:
        return list(segments)
    stride = -(-total // max_chars)  # 向上取整：每 stride 个片段取 1 个，均匀覆盖全片
    return segments[::stride]

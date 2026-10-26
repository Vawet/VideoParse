"""关键词提取：jieba TF-IDF 从字幕里抽取，并标出每个词出现的时间点（可点击跳转）。纯本地计算，不调用 LLM。"""
import logging
from typing import List

import jieba.analyse

from app.services import media

jieba.setLogLevel(logging.WARNING)
# 名词类 / 英文术语 / 专名 / 动名词；过滤掉虚词、数字等没有信息量的词
_POS = ("n", "nz", "vn", "eng", "nr", "ns", "nt", "l")
_BAD = {"大家", "今天", "我们", "东西", "时候", "问题", "方式", "这样", "比如", "一下", "情况", "部分", "内容", "视频", "谢谢",
        # 视觉字幕(画面描述)里常见的套话
        "画面", "副标题", "主标题", "标题", "主题", "对象", "页面", "文字", "图片", "图中", "展示", "介绍", "概览"}


def extract_keywords(segments: List[dict], top_k: int = 12) -> List[dict]:
    """返回 [{word, weight, count, first_time, first_seconds, times:[秒...]}]，按权重降序。"""
    segments = [s for s in segments or [] if (s.get("text") or "").strip()]
    if not segments:
        return []
    text = "\n".join(s["text"] for s in segments)
    out = []
    for word, weight in jieba.analyse.extract_tags(text, topK=top_k * 3, withWeight=True, allowPOS=_POS):
        w = word.strip()
        if len(w) < 2 and not w.isascii() or w in _BAD or w.isdigit() or w[0] in "和与及的或并":
            continue
        low = w.lower()
        hits = [s for s in segments if low in s["text"].lower()]
        if not hits:
            continue
        times = [round(float(s["start_time"]), 1) for s in hits]
        out.append({
            "word": w, "weight": round(float(weight), 3),
            "count": sum(s["text"].lower().count(low) for s in hits),
            "first_seconds": times[0], "first_time": media.seconds_to_hhmmss(times[0]),
            "times": times[:20],
        })
        if len(out) >= top_k:
            break
    return out

"""检索召回评测（离线、不调 LLM）：  cd 后端 && ./.venv/bin/python -m app.tests.eval.retrieval_eval
分别统计"字面提问"与"换说法提问"下 BM25 的 hit@1 / hit@3 / MRR，用来判断是否有必要上向量检索。
新增 Retriever 实现时，在 RETRIEVERS 里登记即可对比。"""
import json
import os

from app.retrieval import Bm25Retriever

# (问题, 期望命中的 golden segment 序号, 类型)
QUERIES = [
    ("自注意力里每个词会生成哪三个向量", 1, "literal"),
    ("注意力权重是怎么算出来的", 2, "literal"),
    ("多头注意力是做什么的", 3, "literal"),
    ("为什么需要位置编码", 4, "literal"),
    ("Transformer 相比循环神经网络有什么优势", 5, "literal"),
    ("这个模型的主要思路是什么", 0, "paraphrase"),
    ("每个token要变成哪几种表示", 1, "paraphrase"),
    ("相关性打分是怎么求的", 2, "paraphrase"),
    ("为什么要把特征拆开分组同时算", 3, "paraphrase"),
    ("模型怎么知道词的先后次序", 4, "paraphrase"),
    ("为什么训练得更快", 5, "paraphrase"),
    ("RNN 为什么慢", 5, "paraphrase"),
]


def load_chunks():
    gold = json.load(open(os.path.join(os.path.dirname(__file__), "golden.json"), encoding="utf-8"))
    return [{"video_id": gold["video_id"], "video_title": "eval", "start": s["start_time"], "end": s["end_time"],
             "text": s["text"]} for s in gold["segments"]]


RETRIEVERS = {"bm25": Bm25Retriever}


def evaluate(make, chunks=None, queries=QUERIES):
    chunks = chunks or load_chunks()
    r = make(chunks)
    stats = {}
    for q, idx, kind in queries:
        hits = r.search(q, top_k=3)
        pos = next((i for i, h in enumerate(hits) if h.start == chunks[idx]["start"]), None)
        s = stats.setdefault(kind, {"n": 0, "hit1": 0, "hit3": 0, "mrr": 0.0})
        s["n"] += 1
        s["hit1"] += pos == 0
        s["hit3"] += pos is not None
        s["mrr"] += 1 / (pos + 1) if pos is not None else 0
    return {k: {"n": v["n"], "hit@1": v["hit1"] / v["n"], "hit@3": v["hit3"] / v["n"], "mrr": round(v["mrr"] / v["n"], 3)}
            for k, v in stats.items()}


def main():
    for name, make in RETRIEVERS.items():
        print(name)
        for kind, m in evaluate(make).items():
            print(f"  {kind:<10} n={m['n']}  hit@1={m['hit@1']:.0%}  hit@3={m['hit@3']:.0%}  mrr={m['mrr']}")


if __name__ == "__main__":
    main()

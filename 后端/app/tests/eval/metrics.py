"""评测指标：全部是纯函数，便于离线单测；真实模型评测见 run_eval.py。"""
from typing import List

from app.agent.loop import NOT_MENTIONED


def score_answer(item: dict, answer: str, citations: List[dict]) -> dict:
    """单题评分。
    - answerable：要求至少一个有效引用(citation_ok)，且有引用落在期望区间内(hit)
    - 不可回答：要求明确回答“视频中未提及”(refused)，并且不能带着有效引用硬答
    """
    valid = [c for c in citations if c["valid"]]
    if item["answerable"]:
        lo, hi = item["expect_range"]
        return {"answerable": True, "citation_ok": bool(valid), "hit": any(lo <= c["seconds"] <= hi for c in valid),
                "bad_citations": len(citations) - len(valid)}
    # 必须明确回答“未提及”（可附带说明视频实际讲了什么）；答非所问（如“视频还没解析完”）不算拒答
    return {"answerable": False, "refused": NOT_MENTIONED in answer and "尚未" not in answer,
            "bad_citations": len(citations) - len(valid)}


def summarize(rows: List[dict]) -> dict:
    ans = [r for r in rows if r["answerable"]]
    unans = [r for r in rows if not r["answerable"]]
    rate = lambda xs, k: round(sum(1 for x in xs if x[k]) / len(xs), 3) if xs else None  # noqa: E731
    out = {
        "n_answerable": len(ans), "n_unanswerable": len(unans),
        "citation_pass_rate": rate(ans, "citation_ok"),   # 有可核对时间戳依据的回答占比
        "hit_rate": rate(ans, "hit"),                      # 引用落在正确位置的占比
        "refusal_rate": rate(unans, "refused"),            # 没依据时正确拒答的占比
        "bad_citation_total": sum(r["bad_citations"] for r in rows),
    }
    if _mean(rows, "steps") is not None:
        out["mean_steps"] = _mean(rows, "steps")
        out["mean_tool_calls"] = _mean(rows, "tool_calls")
        out["repeated_tool_calls"] = sum(r["repeated_tool_calls"] for r in rows)
    return out


def _mean(rows, key):
    if not rows or any(key not in r for r in rows):
        return None
    return round(sum(r[key] for r in rows) / len(rows), 2)


def quiz_stats(res: dict, requested: int) -> dict:
    return {"requested": requested, "accepted": len(res["questions"]), "rejected": res["rejected"],
            "rounds": res["rounds"], "accept_rate": round(len(res["questions"]) / requested, 3) if requested else None}

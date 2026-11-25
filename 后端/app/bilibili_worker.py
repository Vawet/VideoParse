"""Private study-worker operations for Bilibili import and comment analysis."""
from pathlib import Path
import re

from app import config
from app.services import bilibili, grounded


def import_video(params, base):
    target = params["target"]
    if not re.fullmatch(r"bili-[0-9]+\.part", target):
        raise ValueError("Invalid temporary file")
    try:
        data = bilibili.download(params["url"], Path(config.DATA_ROOT, "incoming", target))
        return {"success": True, **data}, 200
    except bilibili.SourceError as exc:
        return {"success": False, "error": str(exc)}, 422
    except OSError:
        return {"success": False, "error": "B 站连接失败，请稍后重试"}, 502


def analyze_comments(params, base):
    try:
        sample = bilibili.comments(params["aid"])[:6]
    except (bilibili.SourceError, OSError):
        return {"success": False, "error": "暂时无法取得公开评论，评论区可能已关闭或受限"}, 502
    result = grounded.compose("归纳这组视频评论中观众关注的问题、补充或分歧。仅描述样本中可验证的观点。",
                              [row["text"] for row in sample])
    return {"success": True, "comments": sample, "claims": result["claims"], "model_status": result["model_status"]}, 200

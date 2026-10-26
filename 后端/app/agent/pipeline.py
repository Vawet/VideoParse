"""确定性解析流水线。

解析主线要求"稳定、低成本、可复现"，所以步骤由代码编排；只有当某一步失败或 validate_result 报告问题时，
才把现场（已有产物 + 问题清单）交给 Agent 去修复。这样 Agent 只在真正需要判断的异常分支里出场。
"""
import logging
from concurrent.futures import ThreadPoolExecutor

from app.agent import tools
from app.agent.state import Workspace

log = logging.getLogger(__name__)

LONG_VIDEO_SECONDS = 1800  # 超过 30 分钟：改用均匀取样，避免去重耗时过长


class _Runner:
    """执行单个工具并发出与 Agent 模式相同形状的事件，前端时间线无需区分模式。"""

    def __init__(self, ws: Workspace, emit):
        self.ws, self.emit, self.step = ws, emit, 0
        self.failures = []  # (tool, error)

    def run(self, name, **args):
        self.step += 1
        step = self.step
        self.emit({"type": "tool_start", "step": step, "tool": name, "args": args})
        obs = tools.run_tool(name, self.ws, args, "analyze")
        ok = "error" not in obs
        self.emit({"type": "tool_end", "step": step, "tool": name, "ok": ok, "observation": obs})
        if not ok:
            self.failures.append((name, obs["error"]))
        return obs


def run_pipeline(ws: Workspace, emit=lambda e: None):
    """跑完整流水线，返回需要 Agent 处理的问题清单（空列表表示一切正常）。"""
    r = _Runner(ws, emit)

    info = r.run("get_video_info")
    if "error" in info:
        return ["无法读取视频: " + info["error"]]
    duration = info["duration_seconds"]

    has_speech = False
    if info["has_audio"]:
        tr = r.run("transcribe")
        has_speech = tr.get("segments", 0) > 0
    else:
        r.emit({"type": "thought", "step": r.step, "text": "视频没有音轨，跳过语音相关步骤，改为只依赖画面。"})

    def text_tasks():
        # 三个文本任务互不依赖，并行执行；事件仍按顺序发出
        with ThreadPoolExecutor(max_workers=3) as ex:
            futures = [ex.submit(r.run, n) for n in ("analyze_structure", "generate_summary", "generate_mindmap")]
            for f in futures:
                f.result()

    if has_speech:
        r.run("correct_transcript")
        text_tasks()

    # 截帧策略由规则决定：短视频用相似度去重(适合 PPT/板书；口播画面变化小，去重后自然帧数少)，长视频均匀取样
    strategy = "interval" if duration > LONG_VIDEO_SECONDS else "slides"
    r.run("extract_keyframes", strategy=strategy, max_frames=30)

    if not has_speech:
        # 没有语音：先写画面笔记，再整理成"视觉字幕"，摘要/分段/脑图/关键词都基于它生成
        r.run("write_frame_notes", max_frames=30)
        if r.run("build_visual_transcript").get("segments"):
            text_tasks()
            if ws.load("heavys", []):
                r.run("extract_heavy_frames")
    else:
        if ws.load("heavys", []):
            r.run("extract_heavy_frames")
        r.run("write_frame_notes", max_frames=30)

    issues = [f"工具 {name} 失败: {err}" for name, err in r.failures]
    check = r.run("validate_result")
    issues += [f"{i['problem']}（建议: {i['fix']}）" for i in check.get("issues", [])]
    # validate_result 本身报告的问题已计入 issues，不重复统计其"失败"
    return issues

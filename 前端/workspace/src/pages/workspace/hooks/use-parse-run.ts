import { useCallback, useEffect, useRef, useState } from "react";
import type { ParseStep, ParseStepId, ParseStepStatus, ResultKey } from "../data/types";

/** The six stages the parsing agent runs through, with their progress windows. */
export const PARSE_STEPS: ParseStep[] = [
  {
    id: "audio",
    label: "提取音频",
    detail: "正在从视频轨分离 16kHz 单声道音轨…",
    doneDetail: "已提取 46 分 12 秒音轨,采样率 16kHz,音量归一完成。",
    from: 0,
    to: 0.08,
  },
  {
    id: "asr",
    label: "语音识别",
    detail: "Whisper 转写中,已识别约 62%…",
    doneDetail: "生成 1,248 条带时间戳的字幕片段,平均置信度 0.94。",
    from: 0.08,
    to: 0.36,
  },
  {
    id: "frames",
    label: "关键帧去重",
    detail: "按画面相似度聚合候选帧,剔除过场动画…",
    doneDetail: "从 128 帧中保留 4 张,去除 97% 的重复画面。",
    from: 0.36,
    to: 0.5,
  },
  {
    id: "segment",
    label: "语义分段",
    detail: "按主题漂移切分章节边界…",
    doneDetail: "切分为 8 个章节,平均时长 5 分 47 秒。",
    from: 0.5,
    to: 0.66,
  },
  {
    id: "notes",
    label: "生成讲义",
    detail: "整理图文混排讲义,并把段落对齐到时间戳…",
    doneDetail: "生成 2,380 字讲义,嵌入 4 张幻灯片与 9 处时间戳引用。",
    from: 0.66,
    to: 0.92,
  },
  {
    id: "verify",
    label: "校验",
    detail: "核对引用时间戳与图文一致性…",
    doneDetail: "校验通过,时间戳误差小于 0.5 秒。",
    from: 0.92,
    to: 1,
  },
];

export type RunMode = "demo" | "upload" | "fail";

const RUN_MS: Record<RunMode, number> = { demo: 16500, upload: 8000, fail: 9500 };

/** Which result groups each finished stage unlocks. */
export const REVEALED_BY_STEP: Record<ParseStepId, ResultKey[]> = {
  audio: [],
  asr: ["chapters", "chat"],
  frames: ["slides"],
  segment: ["mindmap"],
  notes: ["notes", "quiz", "review"],
  verify: ["teach"],
};

/** The failure demo stops inside "生成讲义", so earlier results stay usable. */
const FAIL_AT = 0.72;
const FAILURE_STEP: ParseStepId = "notes";
export const FAILURE_REASON =
  "讲义生成超时:模型返回的章节结构不完整(第 3 段缺少标题)。已完成的语音识别、关键帧与语义分段结果已保留,可以直接查看或重试。";

export type ParseRunState = {
  status: "idle" | "running" | "pausing" | "paused" | "ready" | "failed";
  setLiveState: (state: "running" | "pausing" | "paused") => void;
  toggleDemoPause: () => void;
  progress: number;
  done: ParseStepId[];
  activeStepId: ParseStepId | null;
  failure: { stepId: ParseStepId; reason: string } | null;
  start: (mode: RunMode, options?: { reset?: boolean }) => void;
  reset: () => void;
  /** Live mode: progress is driven by real backend events instead of the simulated clock. */
  beginLive: () => void;
  markLive: (stepId: ParseStepId) => void;
  finishLive: () => void;
  failLive: (stepId: ParseStepId, reason: string) => void;
  stepStatus: (step: ParseStep, didDone: ParseStepId[]) => ParseStepStatus;
};

export function useParseRun(): ParseRunState {
  const [mode, setMode] = useState<RunMode | null>(null);
  const [runToken, setRunToken] = useState(0);
  const resumeAt = useRef(0);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<ParseStepId[]>([]);
  const [status, setStatus] = useState<ParseRunState["status"]>("idle");
  const [failure, setFailure] = useState<ParseRunState["failure"]>(null);

  useEffect(() => {
    if (!mode || status !== "running") return;
    const total = RUN_MS[mode];
    const startedAt = performance.now() - resumeAt.current * total;

    const timer = window.setInterval(() => {
      const ratio = Math.min(1, (performance.now() - startedAt) / total);
      setProgress(ratio);

      if (mode === "fail" && ratio >= FAIL_AT) {
        window.clearInterval(timer);
        resumeAt.current = ratio;
        setStatus("failed");
        setFailure({ stepId: FAILURE_STEP, reason: FAILURE_REASON });
        return;
      }

      setDone((previous) => {
        const reached = PARSE_STEPS.filter((step) => ratio >= step.to).map((step) => step.id);
        if (reached.length === previous.length) return previous;
        // Union, so retrying never takes an already revealed result away.
        const merged = new Set([...previous, ...reached]);
        return PARSE_STEPS.filter((step) => merged.has(step.id)).map((step) => step.id);
      });

      if (ratio >= 1) {
        window.clearInterval(timer);
        setStatus("ready");
      }
    }, 140);

    return () => window.clearInterval(timer);
  }, [mode, runToken, status]);

  const toggleDemoPause = () => {
    if (status === "running") {
      resumeAt.current = progress;
      setStatus("paused");
    } else if (status === "paused") {
      setStatus("running");
    }
  };

  const start = useCallback((nextMode: RunMode, options?: { reset?: boolean }) => {
    if (options?.reset) {
      setDone([]);
      setProgress(0);
      resumeAt.current = 0;
    }
    setStatus("running");
    setFailure(null);
    setMode(nextMode);
    setRunToken((token) => token + 1);
  }, []);

  const reset = useCallback(() => {
    resumeAt.current = 0;
    setMode(null);
    setDone([]);
    setProgress(0);
    setFailure(null);
    setStatus("idle");
  }, []);

  const beginLive = useCallback(() => {
    setMode(null);
    setDone([]);
    setProgress(0);
    setFailure(null);
    setStatus("running");
  }, []);

  const markLive = useCallback((stepId: ParseStepId) => {
    const index = PARSE_STEPS.findIndex((step) => step.id === stepId);
    if (index < 0) return;
    setDone((previous) => {
      const reached = PARSE_STEPS.slice(0, index + 1).map((step) => step.id);
      const merged = new Set([...previous, ...reached]);
      return PARSE_STEPS.filter((step) => merged.has(step.id)).map((step) => step.id);
    });
    setProgress((previous) => Math.max(previous, PARSE_STEPS[index].to));
  }, []);

  const finishLive = useCallback(() => {
    setDone(PARSE_STEPS.map((step) => step.id));
    setProgress(1);
    setStatus("ready");
  }, []);

  const failLive = useCallback((stepId: ParseStepId, reason: string) => {
    setFailure({ stepId, reason });
    setStatus("failed");
  }, []);

  const activeStepId: ParseStepId | null =
    status === "failed" && failure
      ? failure.stepId
      : status === "ready" || status === "idle"
        ? null
        : (PARSE_STEPS.find((step) => progress >= step.from && progress < step.to)?.id ?? null);

  const stepStatus = useCallback(
    (step: ParseStep, currentDone: ParseStepId[]): ParseStepStatus => {
      if (currentDone.includes(step.id)) return "done";
      if (status === "failed" && failure?.stepId === step.id) return "failed";
      if (step.id === activeStepId) return "active";
      return "pending";
    },
    [activeStepId, failure, status],
  );

  return {
    status,
    progress,
    toggleDemoPause,
    setLiveState: setStatus,
    done,
    activeStepId,
    failure,
    start,
    reset,
    beginLive,
    markLive,
    finishLive,
    failLive,
    stepStatus,
  };
}

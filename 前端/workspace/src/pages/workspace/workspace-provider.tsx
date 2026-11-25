import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/sonner";
import { exportSvgToPng } from "@/lib/export-svg-png";
import {
  API_BASE,
  askDemo, askVideo,
  fetchResult,
  getUploadGate,
  startAnalyze,
  subscribeTask,
  uploadVideo,
  verifyUploadGate,
  type RawResult,
} from "@/lib/api";
import { recentTasks, rememberTask, type RecentTask } from "@/lib/recent-tasks";
import { adaptChatAnswer, adaptResult } from "./data/adapter";
import { answerQuestion } from "./data/qa";
import { DEMO_LECTURE, buildLecture, findSegmentAt } from "./data/lecture";
import type { ChatMessage, ParseStep, ParseStepId, ResultKey } from "./data/types";
import { PARSE_STEPS, REVEALED_BY_STEP, useParseRun } from "./hooks/use-parse-run";
import { usePlayer } from "./hooks/use-player";
import { useQuizSession } from "./hooks/use-quiz-session";
import { useReviewSession } from "./hooks/use-review-session";
import {
  NO_RESULTS,
  PlaybackContext,
  WorkspaceContext,
  type TabKey,
  type WorkspaceStatus,
} from "./workspace-context";

const CHAT_DELAY = 1200;

/** Which parse stage each backend Agent tool belongs to (see 后端/app/agent/tools.py). */
const TOOL_STEP: Record<string, ParseStepId> = {
  get_video_info: "audio",
  transcribe: "asr",
  correct_transcript: "asr",
  extract_keyframes: "frames",
  extract_heavy_frames: "frames",
  analyze_structure: "segment",
  generate_summary: "segment",
  generate_mindmap: "segment",
  write_frame_notes: "notes",
  validate_result: "notes",
  finish: "verify",
};

const ALL_RESULTS: Record<ResultKey, boolean> = {
  chapters: true,
  chat: true,
  slides: true,
  mindmap: true,
  notes: true,
  quiz: true,
  review: true,
  teach: true,
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mindmapSvgRef = useRef<SVGSVGElement | null>(null);
  const focusToken = useRef(0);
  const chatTimer = useRef<number | null>(null);
  const chatBusyRef = useRef(false);
  const lastRunMode = useRef<"demo" | "upload" | "fail">("demo");
  const abortRef = useRef<AbortController | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<{ videoId: string; filepath: string; name: string } | null>(null);
  const liveStepRef = useRef<ParseStepId>("audio");
  const liveErrorRef = useRef<string | null>(null);
  const conversationRef = useRef<string | undefined>(undefined);
  const chatGeneration = useRef(0);
  const chatHistoryRef = useRef<unknown[]>([]);

  const [status, setStatus] = useState<WorkspaceStatus>("empty");
  const [videoMode, setVideoMode] = useState<"mock" | "file">("mock");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; size: number } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [title, setTitle] = useState(DEMO_LECTURE.title);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [available, setAvailable] = useState<Record<ResultKey, boolean>>(NO_RESULTS);
  const [focusRequest, setFocusRequest] = useState<{ segmentId: string; token: number } | null>(null);
  const [lightbox, setLightbox] = useState({ open: false, index: 0 });
  const [printMode, setPrintMode] = useState(false);
  const [mindmapExportToken, setMindmapExportToken] = useState(0);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  /** "live" = a real upload parsed by the backend; "demo" = the bundled sample. */
  const [source, setSource] = useState<"demo" | "live">("demo");
  const [rawResult, setRawResult] = useState<RawResult | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);

  const [recent, setRecent] = useState(recentTasks);
  const [stageDetail, setStageDetail] = useState<Partial<Record<ParseStepId,string>>>({});
  const run = useParseRun();
  const liveLecture = useMemo(
    () =>
      rawResult && videoId
        ? adaptResult(rawResult, { videoId, title, mediaDuration })
        : null,
    [rawResult, videoId, title, mediaDuration],
  );
  const duration =
    liveLecture?.duration ??
    (videoMode === "file" && mediaDuration ? mediaDuration : DEMO_LECTURE.duration);
  const lecture = useMemo(() => {
    if (liveLecture) return liveLecture;
    const base = buildLecture(duration);
    // A real upload that has no result yet must not show the sample's content.
    return source === "live" ? { ...base, title, subtitle: "解析中…" } : base;
  }, [liveLecture, duration, source, title]);
  const player = usePlayer({
    mode: videoMode,
    duration,
    mediaRef: videoRef,
    sourceKey: `${videoMode}:${videoUrl ?? "demo"}`,
  });
  const quiz = useQuizSession(lecture.quiz);
  const review = useReviewSession(lecture.review);

  const { segment: activeSegment, index: activeSegmentIndex } = findSegmentAt(
    lecture.segments,
    player.currentTime,
  );

  /* ---------------------------------------------------------------- parsing */

  useEffect(() => {
    if (source === "live" || run.done.length === 0) return;
    setAvailable((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const stepId of run.done) {
        for (const key of REVEALED_BY_STEP[stepId]) {
          if (!next[key]) {
            next[key] = true;
            changed = true;
          }
        }
      }
      return changed ? next : previous;
    });
  }, [run.done, source]);

  useEffect(() => {
    if (status === "uploading") return;
    if (run.status === "ready") setStatus("ready");
    else if (run.status === "failed") setStatus("failed");
  }, [run.status, status]);

  const resetRunOutputs = useCallback(() => {
    setAvailable(NO_RESULTS);
    setMessages([]);
    setChatBusy(false);
    chatBusyRef.current = false;
    chatGeneration.current++;
    conversationRef.current = undefined;
    chatHistoryRef.current = [];
    setNoticeDismissed(false);
    quiz.restart();
    review.restart();
  }, [quiz, review]);

  const beginRun = useCallback(
    (mode: "demo" | "upload" | "fail") => {
      lastRunMode.current = mode;
      resetRunOutputs();
      setActiveTab("overview");
      setLightbox({ open: false, index: 0 });
      run.start(mode, { reset: true });
      setStatus("parsing");
    },
    [resetRunOutputs, run],
  );

  const stopLive = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    sessionRef.current = null;
    setRawResult(null);
    setVideoId(null);
    setSource("demo");
  }, []);

  const loadDemoSource = useCallback(() => {
    stopLive();
    setVideoMode("mock");
    setVideoUrl(null);
    setFileMeta(null);
    setMediaDuration(null);
    setUploadProgress(0);
    setTitle(DEMO_LECTURE.title);
  }, [stopLive]);

  const startDemo = useCallback(() => {
    loadDemoSource();
    beginRun("demo");
  }, [beginRun, loadDemoSource]);

  const startFailureDemo = useCallback(() => {
    loadDemoSource();
    beginRun("fail");
  }, [beginRun, loadDemoSource]);

  const cancelUpload = useCallback(() => {
    stopLive();
    setVideoUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    setVideoMode("mock");
    setFileMeta(null);
    setUploadProgress(0);
    setTitle(DEMO_LECTURE.title);
    setStatus("empty");
  }, [stopLive]);

  /** Starts (or restarts) the backend Agent for the uploaded video and follows its event stream. */
  const runLive = useCallback(async (existingTask?: string) => {
    const session = sessionRef.current;
    if (!session) return;
    unsubscribeRef.current?.();
    liveStepRef.current = "audio";
    liveErrorRef.current = null;
    setStageDetail({});
    resetRunOutputs();
    setRawResult(null);
    setActiveTab("overview");
    run.beginLive();
    setStatus("parsing");

    try {
      const taskId = existingTask ?? (await startAnalyze(session.filepath, session.videoId)).task_id;
      if (sessionRef.current !== session) return;
      if (import.meta.env.VITE_PLATFORM === "true") setRecent(rememberTask({ ...session, taskId }));
      unsubscribeRef.current = subscribeTask(taskId, (event) => {
        if (sessionRef.current !== session) return;
        if (event.type === "tool_start") {
          liveStepRef.current = TOOL_STEP[event.tool] ?? liveStepRef.current;
        } else if (event.type === "tool_end") {
          const step = TOOL_STEP[event.tool];
          if (step && event.ok) {
            const obs = (event.observation ?? {}) as Record<string, unknown>;
            const detail = typeof obs.kept_frames === "number" ? `保留 ${obs.kept_frames} 个关键帧` :
              typeof obs.segments === "number" ? `处理 ${obs.segments} 个片段` :
              typeof obs.sections === "number" ? `生成 ${obs.sections} 个章节` : "服务端已完成此步骤";
            setStageDetail(prev => ({...prev,[step]: obs.resumed ? detail+"（复用检查点）" : detail}));
            run.markLive(step === "verify" ? "notes" : step);
          }
        } else if (event.type === "progress" && event.stage === "publishing") {
          liveStepRef.current = "verify";
          run.markLive("notes");
          const detail = event.retry_in_seconds ? `${event.text}（${event.retry_in_seconds} 秒）` : event.text;
          setStageDetail(prev => ({ ...prev, verify: detail }));
        } else if (event.type === "error") {
          liveErrorRef.current = event.text;
        } else if (event.type === "end") {
          if (event.status !== "done") {
            run.failLive(liveStepRef.current, event.error || liveErrorRef.current || "解析失败");
            return;
          }
          fetchResult(session.videoId)
            .then((result) => {
              if (sessionRef.current !== session) return;
              setRawResult(result);
              setAvailable(ALL_RESULTS);
              setStageDetail(prev => ({ ...prev, verify: "解析结果已就绪" }));
              run.finishLive();
            })
            .catch((error) => run.failLive("verify", `读取解析结果失败:${errorMessage(error)}`));
        }
      });
    } catch (error) {
      run.failLive("audio", errorMessage(error));
    }
  }, [resetRunOutputs, run]);

  const uploadFile = useCallback(
    async (file: File) => {
      stopLive();
      const abort = new AbortController();
      abortRef.current = abort;

      setSource("live");
      setVideoMode("file");
      setVideoUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(file);
      });
      setFileMeta({ name: file.name, size: file.size });
      setMediaDuration(null);
      setUploadProgress(0);
      setTitle(file.name.replace(/\.[^.]+$/, ""));
      resetRunOutputs();
      setStatus("uploading");

      try {
        const gate = await getUploadGate();
        let token = "";
        if (gate.required) {
          const answer = window.prompt(`上传前请先回答:${gate.question}`);
          if (answer === null) throw new DOMException("cancelled", "AbortError");
          token = await verifyUploadGate(answer);
        }
        const uploaded = await uploadVideo(file, token, setUploadProgress, abort.signal);
        setUploadProgress(100);
        sessionRef.current = { videoId: uploaded.video_id, filepath: uploaded.filepath, name: file.name };
        setVideoId(uploaded.video_id);
        setSource("live");
        lastRunMode.current = "upload";
        await runLive();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          cancelUpload();
          return;
        }
        toast.error(errorMessage(error));
        cancelUpload();
      }
    },
    [cancelUpload, resetRunOutputs, runLive, stopLive],
  );

  const reopen = useCallback((row: RecentTask) => {
    stopLive();
    sessionRef.current = {videoId:row.videoId, filepath:row.filepath, name:row.name};
    setVideoMode("file"); setSource("live"); setVideoId(row.videoId); setMediaDuration(null);
    setTitle(row.name.replace(/\.[^.]+$/, ""));
    setVideoUrl(previous => {
      if(previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
      return API_BASE+"/uploads/"+encodeURIComponent(row.filepath);
    });
    setFileMeta(null);
    void runLive(row.taskId);
  }, [runLive, stopLive]);

  const retry = useCallback(() => {
    if (source === "live") {
      void runLive();
      return;
    }
    run.start(lastRunMode.current, { reset: false });
    setStatus("parsing");
  }, [run, runLive, source]);

  const clearProject = useCallback(() => {
    if (chatTimer.current) window.clearTimeout(chatTimer.current);
    chatBusyRef.current = false;
    loadDemoSource();
    resetRunOutputs();
    setActiveTab("overview");
    setLightbox({ open: false, index: 0 });
    run.reset();
    setStatus("empty");
  }, [loadDemoSource, resetRunOutputs, run]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      unsubscribeRef.current?.();
      if (chatTimer.current) window.clearTimeout(chatTimer.current);
    },
    [],
  );

  /* ------------------------------------------------------------ navigation */

  const seek = player.seek;
  const seekTo = useCallback(
    (time: number, options?: { focus?: boolean; segmentId?: string }) => {
      seek(time);
      if (options?.focus === false) return;
      focusToken.current += 1;
      setFocusRequest({
        segmentId: options?.segmentId ?? findSegmentAt(lecture.segments, time).segment.id,
        token: focusToken.current,
      });
    },
    [lecture.segments, seek],
  );

  const jumpToSegment = useCallback(
    (segmentId: string) => {
      const segment = lecture.segments.find((item) => item.id === segmentId);
      if (segment) seekTo(segment.start, { segmentId });
    },
    [lecture.segments, seekTo],
  );

  const jumpToSlide = useCallback(
    (slideId: string) => {
      const slide = lecture.slides.find((item) => item.id === slideId);
      if (slide) seekTo(slide.time, { segmentId: slide.segmentId });
    },
    [lecture.slides, seekTo],
  );

  /* ------------------------------------------------------------------ chat */

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || chatBusyRef.current) return;
      chatBusyRef.current = true;
      const stamp = Date.now();
      const pendingId = `a-${stamp}`;
      setMessages((previous) => [
        ...previous,
        { id: `q-${stamp}`, role: "user", question: trimmed },
        { id: pendingId, role: "assistant", status: "pending" },
      ]);
      setChatBusy(true);

      const generation = chatGeneration.current;
      const settle = (answer: ChatMessage["answer"]) => {
        if (generation !== chatGeneration.current) return;
        setMessages((previous) =>
          previous.map((message) =>
            message.id === pendingId ? { ...message, status: "done", answer } : message,
          ),
        );
        setChatBusy(false);
        chatBusyRef.current = false;
      };

      if (source === "live" && videoId && liveLecture) {
        askVideo(videoId, trimmed, chatHistoryRef.current, conversationRef.current)
          .then((reply) => {
            if (generation !== chatGeneration.current) return;
            conversationRef.current = reply.conversation_id;
            chatHistoryRef.current = reply.history;
            settle(adaptChatAnswer(reply, liveLecture));
          })
          .catch((error) => settle({ text: `问答失败:${errorMessage(error)}`, citations: [] }));
        return;
      }

      if (import.meta.env.VITE_PLATFORM === "true") {
        askDemo(trimmed).then(reply => settle(reply.source === "demo"
          ? answerQuestion(trimmed) : adaptChatAnswer(reply, DEMO_LECTURE)))
          .catch(error => {
            const demo = answerQuestion(trimmed);
            settle({ ...demo, text: `自动选源暂不可用（${errorMessage(error)}）。以下来自内置示例。\n\n${demo.text}` });
          });
        return;
      }
      if (chatTimer.current) window.clearTimeout(chatTimer.current);
      chatTimer.current = window.setTimeout(() => settle(answerQuestion(trimmed)), CHAT_DELAY);
    },
    [liveLecture, source, videoId],
  );

  const clearChat = useCallback(() => {
    chatGeneration.current++;
    conversationRef.current = undefined;
    chatHistoryRef.current = [];
    if (chatTimer.current) window.clearTimeout(chatTimer.current);
    chatBusyRef.current = false;
    setChatBusy(false);
    setMessages([]);
  }, []);

  /* -------------------------------------------------------------- overlays */

  const openLightbox = useCallback((index: number) => setLightbox({ open: true, index }), []);
  const closeLightbox = useCallback(
    () => setLightbox((current) => ({ ...current, open: false })),
    [],
  );
  const stepLightbox = useCallback(
    (delta: number) =>
      setLightbox((current) => {
        const count = lecture.slides.length;
        if (count === 0) return current;
        return { ...current, index: (current.index + delta + count) % count };
      }),
    [lecture.slides.length],
  );

  useEffect(() => {
    if (!printMode) return;
    const finish = () => setPrintMode(false);
    window.addEventListener("afterprint", finish);
    const timer = window.setTimeout(() => window.print(), 250);
    return () => {
      window.removeEventListener("afterprint", finish);
      window.clearTimeout(timer);
    };
  }, [printMode]);

  const exportNotes = useCallback(() => setPrintMode(true), []);

  const registerMindmapSvg = useCallback((element: SVGSVGElement | null) => {
    mindmapSvgRef.current = element;
  }, []);

  const exportMindmap = useCallback(() => {
    setActiveTab("mindmap");
    setMindmapExportToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (mindmapExportToken === 0) return;
    const element = mindmapSvgRef.current;
    if (!element) return;
    exportSvgToPng(element, `${title} 思维导图`)
      .then(() => toast.success("思维导图已导出为 PNG"))
      .catch(() => toast.error("思维导图导出失败,请重试"));
  }, [mindmapExportToken, title]);

  const reportMediaDuration = useCallback((value: number) => {
    if (Number.isFinite(value) && value > 0) setMediaDuration(value);
  }, []);

  const activeStep: ParseStep | null =
    PARSE_STEPS.find((step) => step.id === run.activeStepId) ?? null;

  const workspaceValue = {
    status,
    title,
    lecture,
    duration,
    progress: run.progress,
    steps: source === "live" ? PARSE_STEPS.map(step => ({...step,detail:stageDetail[step.id] ?? "正在处理…",doneDetail:stageDetail[step.id] ?? "已完成"})) : PARSE_STEPS,
    recent, reopen,
    stepStatus: (step: ParseStep) => run.stepStatus(step, run.done),
    activeStep,
    failure: run.failure,
    available,
    unlockingKeys: activeStep ? REVEALED_BY_STEP[activeStep.id] : [],
    uploadProgress,
    fileMeta,
    showDemoNotice:
      source === "demo" && (status === "parsing" || status === "ready") && !noticeDismissed,
    isLive: source === "live",
    videoId,
    dismissDemoNotice: () => setNoticeDismissed(true),
    activeTab,
    setActiveTab,
    activeSegmentId: activeSegment.id,
    activeSegmentIndex,
    focusRequest,
    seekTo,
    jumpToSegment,
    jumpToSlide,
    startDemo,
    startFailureDemo,
    uploadFile,
    cancelUpload,
    retry,
    clearProject,
    videoMode,
    videoUrl,
    videoRef,
    posterImage: lecture.slides[0]?.image ?? "",
    reportMediaDuration,
    messages,
    chatBusy,
    ask,
    clearChat,
    quiz,
    review,
    lightbox,
    openLightbox,
    closeLightbox,
    stepLightbox,
    printMode,
    exportNotes,
    exportMindmap,
    registerMindmapSvg,
  };

  const playbackValue = {
    currentTime: player.currentTime,
    playing: player.playing,
    rate: player.rate,
    duration,
    toggle: player.toggle,
    skip: player.skip,
    seek: player.seek,
    setRate: player.setRate,
  };

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <PlaybackContext.Provider value={playbackValue}>{children}</PlaybackContext.Provider>
    </WorkspaceContext.Provider>
  );
}

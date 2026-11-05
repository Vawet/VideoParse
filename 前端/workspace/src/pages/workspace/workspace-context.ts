import { createContext, type RefObject } from "react";
import type { PlayerMode } from "./hooks/use-player";
import type { RunMode } from "./hooks/use-parse-run";
import type { QuizSession } from "./hooks/use-quiz-session";
import type { ReviewSession } from "./hooks/use-review-session";
import type {
  ChatMessage,
  LectureData,
  ParseStep,
  ParseStepId,
  ParseStepStatus,
  ResultKey,
} from "./data/types";

export const TAB_KEYS = [
  "overview",
  "notes",
  "mindmap",
  "slides",
  "chat",
  "quiz",
  "review",
  "teach",
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export type WorkspaceStatus = "empty" | "uploading" | "parsing" | "ready" | "failed";

export const NO_RESULTS: Record<ResultKey, boolean> = {
  chapters: false,
  chat: false,
  slides: false,
  mindmap: false,
  notes: false,
  quiz: false,
  review: false,
  teach: false,
};

export type WorkspaceValue = {
  status: WorkspaceStatus;
  title: string;
  lecture: LectureData;
  duration: number;

  /** Parse run */
  progress: number;
  steps: ParseStep[];
  stepStatus: (step: ParseStep) => ParseStepStatus;
  activeStep: ParseStep | null;
  failure: { stepId: ParseStepId; reason: string } | null;
  available: Record<ResultKey, boolean>;
  /** Result groups the currently running stage is about to unlock. */
  unlockingKeys: ResultKey[];
  uploadProgress: number;
  fileMeta: { name: string; size: number } | null;
  showDemoNotice: boolean;
  /** True when the lecture comes from a real backend parse, not the bundled sample. */
  isLive: boolean;
  dismissDemoNotice: () => void;

  /** Navigation */
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  activeSegmentId: string;
  activeSegmentIndex: number;
  focusRequest: { segmentId: string; token: number } | null;
  seekTo: (time: number, options?: { focus?: boolean; segmentId?: string }) => void;
  jumpToSegment: (segmentId: string) => void;
  jumpToSlide: (slideId: string) => void;

  /** Project lifecycle */
  startDemo: () => void;
  startFailureDemo: () => void;
  uploadFile: (file: File) => void | Promise<void>;
  cancelUpload: () => void;
  retry: () => void;
  clearProject: () => void;

  /** Video */
  videoMode: PlayerMode;
  videoUrl: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  posterImage: string;
  reportMediaDuration: (duration: number) => void;

  /** Chat */
  messages: ChatMessage[];
  chatBusy: boolean;
  ask: (question: string) => void;
  clearChat: () => void;

  /** Study sessions (kept here so tab switches never lose progress) */
  quiz: QuizSession;
  review: ReviewSession;

  /** Overlays and export */
  lightbox: { open: boolean; index: number };
  openLightbox: (index: number) => void;
  closeLightbox: () => void;
  stepLightbox: (delta: number) => void;
  printMode: boolean;
  exportNotes: () => void;
  exportMindmap: () => void;
  registerMindmapSvg: (element: SVGSVGElement | null) => void;
};

/** High-frequency playback state, isolated so reading panes never re-render per tick. */
export type PlaybackValue = {
  currentTime: number;
  playing: boolean;
  rate: number;
  duration: number;
  toggle: () => void;
  skip: (delta: number) => void;
  seek: (time: number) => void;
  setRate: (rate: number) => void;
};

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);
export const PlaybackContext = createContext<PlaybackValue | null>(null);

export type { RunMode };

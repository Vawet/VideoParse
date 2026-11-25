/**
 * Data contract for a parsed video. Every field is what a real parser would
 * return, so the mock module can be swapped for a backend response verbatim.
 */

export type Segment = {
  id: string;
  start: number;
  end: number;
  title: string;
  summary: string;
};

export type Slide = {
  id: string;
  time: number;
  image: string;
  title: string;
  caption: string;
  segmentId: string;
};

export type MindmapNode = {
  id: string;
  label: string;
  time?: number;
  children?: MindmapNode[];
};

export type Citation = {
  segmentId: string;
  time: number;
  quote: string;
  slideId?: string;
};

export type QuizQuestion = {
  id: string;
  kind: "choice" | "short";
  segmentId: string;
  time: number;
  question: string;
  options?: { id: string; label: string }[];
  answerId?: string;
  modelAnswer?: string;
  explanation: string;
};

export type ReviewCard = {
  id: string;
  segmentId: string;
  time: number;
  prompt: string;
  answer: string;
  /** Days until the first scheduled review. */
  intervalDays: number;
};

export type GlossaryItem = { term: string; definition: string };

export type LectureData = {
  id: string;
  title: string;
  subtitle: string;
  duration: number;
  stats: { words: number; framesTotal: number; framesKept: number };
  overview: { summary: string; keyPoints: string[]; glossary: GlossaryItem[] };
  segments: Segment[];
  notesMarkdown: string;
  mindmap: MindmapNode;
  slides: Slide[];
  quiz: QuizQuestion[];
  review: ReviewCard[];
};

export type ChatAnswer = {
  webSources?: import("@/lib/api").WebSource[];
  text: string;
  bullets?: string[];
  citations: Citation[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  question?: string;
  answer?: ChatAnswer;
  status?: "pending" | "done";
};

export type ParseStepId = "audio" | "asr" | "frames" | "segment" | "notes" | "verify";

export type ParseStepStatus = "pending" | "active" | "done" | "failed";

export type ParseStep = {
  id: ParseStepId;
  label: string;
  /** One-line description while the step runs. */
  detail: string;
  /** What the step actually produced, shown once it is done. */
  doneDetail: string;
  from: number;
  to: number;
};

/** Result groups revealed as the parse run advances. */
export type ResultKey =
  | "chapters"
  | "chat"
  | "slides"
  | "mindmap"
  | "notes"
  | "quiz"
  | "review"
  | "teach";

export type Availability = Partial<Record<ResultKey, boolean>>;

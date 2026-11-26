import { formatTime } from "@/lib/format";

export type Source = {
  name: string; firstLine: number; lastLine: number; docId: string | null; videoId?: string | null;
  passageKey?: string | null; origin?: string; start?: number | null; end?: number | null;
};
export type Passage = Source & {frame?: string | null; heading: string; ordinal: number; body: string};

export function passageKey(hit: Passage) {
  return hit.videoId ? "video/" + hit.videoId + "/" + hit.passageKey : "document/" + hit.docId + "/" + hit.ordinal;
}

const labels: Record<string,string> = {speech:"字幕", ocr:"画面文字", frame_note:"AI 画面描述",
  chapter:"AI 章节概述", notes:"AI 讲义", summary:"AI 摘要", mindmap:"AI 思维导图"};

export function sourceLabel(hit: Source) {
  if (!hit.videoId) return hit.name + " · 第 " + hit.firstLine + "–" + hit.lastLine + " 行";
  const range = hit.start == null ? "" : " · " + formatTime(hit.start) +
    (hit.end != null && hit.end > hit.start ? "–" + formatTime(hit.end) : "");
  return hit.name + " · " + (labels[hit.origin ?? ""] ?? "视频片段") + range;
}

export function videoPassagePath(source: Source) {
  return "/videos/" + encodeURIComponent(source.videoId!) + "/passages/" + encodeURIComponent(source.passageKey!);
}

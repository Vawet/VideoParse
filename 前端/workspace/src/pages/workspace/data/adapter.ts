import type { RawMindNode, RawResult } from "@/lib/api";
import { formatTime } from "@/lib/format";
import type { ChatAnswer, LectureData, MindmapNode, Segment, Slide } from "./types";

/** "H:MM:SS" / "MM:SS" / "SS" → seconds. */
export function parseClock(value: string | undefined): number {
  if (!value) return 0;
  const parts = value
    .trim()
    .split(":")
    .map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseRange(range: string): { start: number; end: number } {
  const [start, end] = range.split("-").map((part) => parseClock(part));
  return { start: start ?? 0, end: end ?? start ?? 0 };
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstHeading(markdown: string): string | null {
  const match = markdown.match(/^#{1,3}\s+(.+)$/m);
  return match ? stripMarkdown(match[1]) : null;
}

function adaptMindmap(node: RawMindNode | undefined, fallbackLabel: string, path = "m"): MindmapNode {
  const label = (node?.name ?? fallbackLabel).trim() || fallbackLabel;
  const id = `${path}`;
  return {
    id,
    label,
    children: node?.children?.length
      ? node.children.map((child, index) => adaptMindmap(child, "节点", `${path}-${index}`))
      : undefined,
  };
}

/** Maps the backend's result.json onto the workbench's LectureData contract. */
export function adaptResult(
  raw: RawResult,
  options: { videoId: string; title: string; mediaDuration: number | null },
): LectureData {
  const frames = (raw.segments ?? []).map((frame) => ({
    frame,
    ...parseRange(frame.time_range),
  }));
  const lastFrameEnd = frames.reduce((max, item) => Math.max(max, item.end), 0);
  const division = raw.division ?? [];
  const lastDivisionEnd = division.reduce(
    (max, item) => Math.max(max, parseClock(item.time_range?.end_time)),
    0,
  );
  // The player's own duration wins; the backend's timestamps are the fallback.
  const duration = Math.max(
    1,
    Math.round(options.mediaDuration || Math.max(lastDivisionEnd, lastFrameEnd)),
  );

  let segments: Segment[] = division.map((item, index) => ({
    id: `s${index + 1}`,
    start: parseClock(item.time_range?.start_time),
    end: parseClock(item.time_range?.end_time),
    title: item.title || `章节 ${index + 1}`,
    summary: Array.isArray(item.summary) ? item.summary.join(";") : (item.summary ?? ""),
  }));
  if (segments.length === 0 && frames.length > 0) {
    segments = frames.map((item, index) => ({
      id: `s${index + 1}`,
      start: item.start,
      end: item.end,
      title: firstHeading(item.frame.notes?.content ?? "") ?? `片段 ${index + 1}`,
      summary: stripMarkdown(item.frame.notes?.content ?? "").slice(0, 80),
    }));
  }
  if (segments.length === 0) {
    segments = [{ id: "s1", start: 0, end: duration, title: options.title, summary: raw.summary ?? "" }];
  }
  segments[segments.length - 1] = { ...segments[segments.length - 1], end: Math.max(segments[segments.length - 1].end, duration) };

  const segmentAt = (time: number) =>
    segments.find((segment) => time >= segment.start && time < segment.end) ??
    segments[segments.length - 1];

  const slides: Slide[] = frames.map((item, index) => {
    const content = item.frame.notes?.content ?? "";
    const caption = stripMarkdown(content) || item.frame.captions || "";
    return {
      id: `f${index + 1}`,
      time: item.start,
      image: item.frame.image,
      title: firstHeading(content) ?? `画面 ${formatTime(item.start)}`,
      caption: caption.slice(0, 160),
      segmentId: segmentAt(item.start).id,
    };
  });

  const noteParts: string[] = [];
  if (raw.summary) noteParts.push(raw.summary);
  segments.forEach((segment) => {
    const lines = [`## ${segment.title}`];
    if (segment.summary) lines.push(segment.summary);
    lines.push(`[${formatTime(segment.start)}](#t=${segment.start})`);
    slides
      .filter((slide) => slide.segmentId === segment.id)
      .forEach((slide) => {
        const frame = frames[slides.indexOf(slide)].frame;
        const body = (frame.notes?.content ?? "")
          .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
          .replace(/^#{1,2}\s+/gm, "### ")
          .trim();
        lines.push(`![${slide.title}](#slide-${slide.id})`);
        if (body) lines.push(body);
      });
    noteParts.push(lines.join("\n\n"));
  });
  const notesMarkdown = noteParts.join("\n\n");

  const keyPoints = raw.highlights?.length ? raw.highlights : segments.map((segment) => segment.title);
  const mindData = raw.mind_map?.mind_map?.data;

  return {
    id: options.videoId,
    title: options.title,
    subtitle: `${segments.length} 章节 · ${slides.length} 幻灯片`,
    duration,
    stats: {
      words: notesMarkdown.length,
      framesTotal: Math.max(slides.length, 1),
      framesKept: slides.length,
    },
    overview: { summary: raw.summary ?? "", keyPoints, glossary: [] },
    segments,
    notesMarkdown,
    mindmap: adaptMindmap(mindData, options.title),
    slides,
    quiz: [],
    review: [],
  };
}

/** Maps a /chat reply to the ChatAnswer shape, attaching each valid citation to its chapter. */
export function adaptChatAnswer(
  reply: Pick<import("@/lib/api").ChatReply, "answer" | "web_sources" | "citations">,
  lecture: LectureData,
): ChatAnswer {
  const citations = reply.citations
    .filter((citation) => citation.valid)
    .map((citation) => {
      const segment =
        lecture.segments.find(
          (item) => citation.seconds >= item.start && citation.seconds < item.end,
        ) ?? lecture.segments[lecture.segments.length - 1];
      const slide = [...lecture.slides].reverse().find((item) => item.time <= citation.seconds);
      return {
        segmentId: segment.id,
        time: citation.seconds,
        quote: citation.text,
        slideId: slide?.id,
      };
    });
  return { text: reply.answer, citations, webSources: reply.web_sources };
}

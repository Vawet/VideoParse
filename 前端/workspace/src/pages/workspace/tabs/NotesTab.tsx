import { useCallback, useEffect, useRef } from "react";
import { ArrowUpRight, FileDown } from "lucide-react";
import { useWorkspace } from "../hooks/use-workspace";
import { NotesArticle } from "../components/NotesArticle";
import { TimestampChip } from "../components/TimestampChip";

/** Markdown notes with inline key frames, timestamp chips and PDF export. */
export function NotesTab() {
  const {
    lecture,
    activeSegmentId,
    activeSegmentIndex,
    focusRequest,
    seekTo,
    openLightbox,
    exportNotes,
  } = useWorkspace();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleJump = useCallback((seconds: number) => seekTo(seconds), [seekTo]);
  const handleOpenSlide = useCallback((index: number) => openLightbox(index), [openLightbox]);

  // A jump made elsewhere in the workbench scrolls the notes to that section.
  useEffect(() => {
    if (!focusRequest) return;
    const target = containerRef.current?.querySelector(`#seg-${focusRequest.segmentId}`);
    target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  }, [focusRequest]);

  const activeSegment = lecture.segments[activeSegmentIndex];

  return (
    <div ref={containerRef} className="mx-auto max-w-3xl space-y-4">
      <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/70 bg-card/40 px-3.5 py-2.5">
        <span className="tool-heading">课程讲义</span>
        <span className="hidden h-px w-6 bg-border sm:block" aria-hidden />
        <span className="text-[11px] text-muted-foreground">
          当前
          <span className="ml-1.5 text-foreground/85">
            {String(activeSegmentIndex + 1).padStart(2, "0")} · {activeSegment?.title}
          </span>
        </span>
        <TimestampChip
          seconds={activeSegment?.start ?? 0}
          onJump={handleJump}
          variant="plain"
          className="text-[10px]"
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="label-mono hidden text-[9px] sm:inline">
            {lecture.slides.length} slides
          </span>
          <button
            type="button"
            onClick={exportNotes}
            className="group inline-flex items-center gap-2 rounded-full border border-border py-1 pl-3.5 pr-1 text-[11px] text-foreground transition-colors duration-200 ease-smooth hover:border-primary/50 hover:bg-accent"
          >
            导出 PDF
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold/15 text-gold">
              <FileDown className="h-3 w-3" aria-hidden />
            </span>
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/40 p-5 md:p-8">
        <NotesArticle
          markdown={lecture.notesMarkdown}
          segments={lecture.segments}
          slides={lecture.slides}
          highlightSegmentId={activeSegmentId}
          onJump={handleJump}
          onOpenSlide={handleOpenSlide}
        />
      </div>

      <div className="flex items-center gap-3 pb-2">
        <span className="label-mono text-[9px]">End of notes</span>
        <span className="h-px flex-1 bg-border/50" aria-hidden />
        <ArrowUpRight className="h-3.5 w-3.5 text-gold/50" aria-hidden />
      </div>
    </div>
  );
}

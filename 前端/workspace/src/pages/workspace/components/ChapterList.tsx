import { useEffect, useRef } from "react";
import { formatTime, toPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePlayback, useWorkspace } from "../hooks/use-workspace";

/** Clickable chapter timeline, styled like an editorial table of contents. */
export function ChapterList() {
  const { lecture, available, activeSegmentId, activeSegmentIndex, jumpToSegment, activeStep } =
    useWorkspace();
  const { currentTime } = usePlayback();
  const activeRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSegmentId]);

  const ready = available.chapters;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/50">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3.5 py-2.5">
        <span className="label-mono text-[9px]">02 · Chapters</span>
        <span className="h-px flex-1 bg-border/60" aria-hidden />
        {ready ? (
          <>
            <span className="font-mono text-[10px] tabular-nums text-gold">
              {formatTime(lecture.duration)}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {String(activeSegmentIndex + 1).padStart(2, "0")}/{String(lecture.segments.length).padStart(2, "0")}
            </span>
          </>
        ) : (
          <span className="label-mono text-[9px]">生成中</span>
        )}
      </div>

      <div className="vp-scroll min-h-0 max-h-[42vh] flex-1 overflow-y-auto md:max-h-none">
        {ready ? (
          <ol>
            {lecture.segments.map((segment, index) => {
              const isActive = segment.id === activeSegmentId;
              const progress = isActive
                ? toPercent(currentTime - segment.start, segment.end - segment.start)
                : 0;
              return (
                <li
                  key={segment.id}
                  ref={isActive ? activeRef : undefined}
                  className="border-b border-border/40 last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => jumpToSegment(segment.id)}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      "group relative flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors duration-200 ease-smooth",
                      isActive ? "bg-accent/50" : "hover:bg-accent/25",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 w-[2px] transition-colors duration-200 ease-smooth",
                        isActive ? "bg-primary" : "bg-transparent",
                      )}
                      aria-hidden
                    />
                    <span
                      className={cn(
                        "display-italic mt-0.5 w-6 shrink-0 text-[15px] leading-none",
                        isActive ? "text-primary" : "text-gold/60",
                      )}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            "truncate text-[13px] leading-snug",
                            isActive ? "text-foreground" : "text-foreground/85",
                          )}
                        >
                          {segment.title}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-gold/80">
                          {formatTime(segment.start)}
                        </span>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-muted-foreground">
                        {segment.summary}
                      </span>
                      {isActive ? (
                        <span className="mt-2 block h-px w-full overflow-hidden bg-border">
                          <span
                            className="block h-full bg-primary transition-[width] duration-200 ease-linear"
                            style={{ width: `${progress}%` }}
                          />
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="space-y-3 p-3.5">
            <p className="label-mono text-[9px]">
              {activeStep ? `${activeStep.label} · 等待章节` : "等待解析"}
            </p>
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="relative overflow-hidden space-y-2">
                <div className="h-2.5 w-24 rounded-sm bg-border/70" />
                <div className="h-2 w-4/5 rounded-sm bg-border/40" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

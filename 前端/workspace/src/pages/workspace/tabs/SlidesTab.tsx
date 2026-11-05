import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, Grid2x2, Layers, ScanEye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../hooks/use-workspace";
import { TimestampChip } from "../components/TimestampChip";

/** De-duplicated key frames, with grid and single-slide review modes. */
export function SlidesTab() {
  const { lecture, activeSegmentId, seekTo, openLightbox, jumpToSlide } = useWorkspace();
  const [mode, setMode] = useState<"grid" | "focus">("grid");
  const [focusIndex, setFocusIndex] = useState(0);

  // In focus mode the viewer follows the chapter that is playing.
  useEffect(() => {
    if (mode !== "focus") return;
    const index = lecture.slides.findIndex((slide) => slide.segmentId === activeSegmentId);
    if (index >= 0) setFocusIndex(index);
  }, [activeSegmentId, lecture.slides, mode]);

  const slide = lecture.slides[Math.min(focusIndex, lecture.slides.length - 1)];
  const keptPercent = Math.round((lecture.stats.framesKept / lecture.stats.framesTotal) * 100);

  if (lecture.slides.length === 0 || !slide) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
        这个视频没有提取到关键帧。
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="label-mono text-[9px]">01 · Key frames</span>
        <span className="h-px w-6 bg-border" aria-hidden />
        <span className="text-[11px] text-muted-foreground">
          从 {lecture.stats.framesTotal} 帧保留 {lecture.stats.framesKept} 张
          <span className="ml-1 font-mono text-gold/80">−{100 - keptPercent}%</span>
        </span>
        <div className="ml-auto flex items-center gap-1 rounded-full border border-border/70 p-0.5">
          <button
            type="button"
            onClick={() => setMode("grid")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] transition-colors duration-200 ease-smooth",
              mode === "grid"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Grid2x2 className="h-3 w-3" aria-hidden />
            列表
          </button>
          <button
            type="button"
            onClick={() => setMode("focus")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] transition-colors duration-200 ease-smooth",
              mode === "focus"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ScanEye className="h-3 w-3" aria-hidden />
            专注
          </button>
        </div>
      </div>

      {mode === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {lecture.slides.map((item, index) => {
            const segment = lecture.segments.find((candidate) => candidate.id === item.segmentId);
            const isCurrent = item.segmentId === activeSegmentId;
            return (
              <figure
                key={item.id}
                className={cn(
                  "group overflow-hidden rounded-xl border bg-card/40 transition-colors duration-200 ease-smooth",
                  isCurrent ? "border-primary/45" : "border-border/70 hover:border-border",
                )}
              >
                <div className="frame-brackets m-1">
                  <button
                    type="button"
                    onClick={() => jumpToSlide(item.id)}
                    aria-label={`跳转到视频 ${item.title}`}
                    className="relative block w-full overflow-hidden rounded-sm"
                  >
                    <img
                      src={item.image}
                      alt={item.title}
                      crossOrigin="anonymous"
                      loading="lazy"
                      className="w-full border border-border/50 transition-transform duration-200 ease-smooth group-hover:scale-[1.01]"
                    />
                    {isCurrent ? (
                      <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-background/80 px-2 py-0.5 backdrop-blur">
                        <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-primary" aria-hidden />
                        <span className="label-mono text-[8px] text-foreground">Now playing</span>
                      </span>
                    ) : null}
                  </button>
                </div>
                <figcaption className="space-y-2 p-3.5">
                  <div className="flex items-start gap-2">
                    <span className="display-italic w-5 shrink-0 text-[12px] leading-5 text-gold/60">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[12px] leading-snug text-foreground">{item.title}</span>
                    <TimestampChip
                      seconds={item.time}
                      onJump={(seconds) => seekTo(seconds, { segmentId: item.segmentId })}
                      className="ml-auto shrink-0"
                    />
                  </div>
                  <p className="pl-7 text-[11px] leading-relaxed text-muted-foreground">
                    {item.caption}
                  </p>
                  <div className="flex items-center gap-2 pl-7">
                    <span className="label-mono truncate text-[8px]">
                      {segment ? segment.title : "—"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-6 gap-1 rounded-full px-2 text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => openLightbox(index)}
                    >
                      <Expand className="h-3 w-3" aria-hidden />
                      放大
                    </Button>
                  </div>
                </figcaption>
              </figure>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="frame-brackets m-1">
            <div className="overflow-hidden rounded-sm border border-border/50 bg-card">
              <img
                src={slide.image}
                alt={slide.title}
                crossOrigin="anonymous"
                className="mx-auto max-h-[52vh] w-full object-contain"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TimestampChip
              seconds={slide.time}
              onJump={(seconds) => seekTo(seconds, { segmentId: slide.segmentId })}
            />
            <span className="text-[13px] text-foreground">{slide.title}</span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {String(focusIndex + 1).padStart(2, "0")} / {String(lecture.slides.length).padStart(2, "0")}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full"
                aria-label="上一张"
                onClick={() =>
                  setFocusIndex((value) =>
                    (value - 1 + lecture.slides.length) % lecture.slides.length,
                  )
                }
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full"
                aria-label="下一张"
                onClick={() => setFocusIndex((value) => (value + 1) % lecture.slides.length)}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
              <button
                type="button"
                onClick={() => seekTo(slide.time, { segmentId: slide.segmentId })}
                className="rounded-full border border-border px-3 py-1.5 text-[11px] text-foreground transition-colors duration-200 ease-smooth hover:border-primary/50 hover:bg-accent"
              >
                跳转到视频
              </button>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{slide.caption}</p>
        </div>
      )}

      <div className="flex items-center gap-3 pb-2">
        <Layers className="h-3.5 w-3.5 text-gold/50" aria-hidden />
        <span className="label-mono text-[8px]">frames deduplicated by scene similarity</span>
        <span className="h-px flex-1 bg-border/50" aria-hidden />
      </div>
    </div>
  );
}

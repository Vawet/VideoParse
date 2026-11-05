import { useEffect } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatTime } from "@/lib/format";
import { useWorkspace } from "../hooks/use-workspace";
import { TimestampChip } from "./TimestampChip";

/** Full-bleed slide viewer with keyboard navigation. */
export function SlideLightbox() {
  const { lightbox, lecture, closeLightbox, stepLightbox, seekTo } = useWorkspace();
  const slide = lecture.slides[lightbox.index];

  useEffect(() => {
    if (!lightbox.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        stepLightbox(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepLightbox(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightbox.open, stepLightbox]);

  if (!slide) return null;

  return (
    <Dialog open={lightbox.open} onOpenChange={(open) => (open ? undefined : closeLightbox())}>
      <DialogContent className="max-w-5xl gap-3 border-border/70 bg-background/95 p-3 shadow-elevated backdrop-blur sm:p-5">
        <DialogTitle className="sr-only">幻灯片放大查看</DialogTitle>
        <div className="frame-brackets">
          <img
            src={slide.image}
            alt={slide.title}
            crossOrigin="anonymous"
            className="max-h-[68vh] w-full rounded-sm border border-border/60 object-contain"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 px-1">
          <TimestampChip seconds={slide.time} onJump={(seconds) => seekTo(seconds)} />
          <span className="text-sm font-medium">{slide.title}</span>
          <span className="text-xs text-muted-foreground">
            {lightbox.index + 1} / {lecture.slides.length} · {formatTime(slide.time)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => stepLightbox(-1)}
              aria-label="上一张幻灯片"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => stepLightbox(1)}
              aria-label="下一张幻灯片"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="ml-1 gap-1.5"
              onClick={() => {
                seekTo(slide.time, { segmentId: slide.segmentId });
                closeLightbox();
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              跳转到视频
            </Button>
          </div>
        </div>
        <p className="px-1 pb-1 text-xs leading-relaxed text-muted-foreground">{slide.caption}</p>
      </DialogContent>
    </Dialog>
  );
}

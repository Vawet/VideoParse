import { Expand } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Slide } from "../data/types";
import { TimestampChip } from "./TimestampChip";

type SlideFigureProps = {
  slide: Slide;
  onOpen: () => void;
  onJump: (seconds: number) => void;
  className?: string;
};

/** A key frame embedded in the notes: click the image to enlarge, the chip to jump. */
export function SlideFigure({ slide, onOpen, onJump, className }: SlideFigureProps) {
  return (
    <figure className={cn("not-prose my-6", className)}>
      <div className="relative m-1">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`放大查看幻灯片:${slide.title}`}
          className="group relative block w-full overflow-hidden rounded-sm border border-border/60 bg-card"
        >
          <img
            src={slide.image}
            alt={slide.title}
            crossOrigin="anonymous"
            loading="lazy"
            className="w-full transition-transform duration-200 ease-smooth group-hover:scale-[1.01]"
          />
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2 py-1 opacity-0 backdrop-blur transition-opacity duration-200 ease-smooth group-hover:opacity-100 group-focus-visible:opacity-100">
            <Expand className="h-2.5 w-2.5 text-gold" aria-hidden />
            <span className="label-mono text-[8px] text-foreground">放大</span>
          </span>
        </button>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <TimestampChip seconds={slide.time} onJump={onJump} />
        <span className="text-[11px] text-foreground/90">{slide.title}</span>
        <span className="text-[10px] leading-relaxed text-muted-foreground">{slide.caption}</span>
      </figcaption>
    </figure>
  );
}

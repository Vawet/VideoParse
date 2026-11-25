import { useState } from "react";
import { formatTime } from "@/lib/format";
import { DEMO_LECTURE } from "../data/lecture";

export function KeyframePreview() {
  const slides = DEMO_LECTURE.slides;
  const [selected,setSelected] = useState(0);
  const slide = slides[selected];
  if (!slide) return null;
  return <section aria-label="示例课程关键帧" className="my-6 space-y-3">
    <h2 className="text-lg font-semibold">示例课程关键帧</h2>
    <div className="grid overflow-hidden rounded-xl border bg-card sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <figure className="min-w-0">
        <img src={slide.image} alt={slide.title} className="aspect-video w-full bg-muted object-contain" loading="lazy"/>
        <figcaption className="px-4 py-3 text-sm leading-relaxed">{slide.caption}</figcaption>
      </figure>
      <div role="group" aria-label="选择关键帧" className="flex flex-col justify-center gap-1 border-t p-2 sm:border-l sm:border-t-0">
        {slides.map((item,i)=><button key={item.id} type="button" aria-pressed={i===selected} onClick={()=>setSelected(i)}
          className="flex items-baseline gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent aria-pressed:bg-primary/10 aria-pressed:text-primary">
          <span className="font-mono text-xs tabular-nums">{formatTime(item.time)}</span><span>{item.title}</span>
        </button>)}
      </div>
    </div>
  </section>;
}

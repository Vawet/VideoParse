import { ArrowUpRight, BookOpen, ListChecks, Quote } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { formatTime } from "@/lib/format";
import { useWorkspace } from "../hooks/use-workspace";

/** The "what you got" view: summary, key points, stats, glossary, entry points. */
export function OverviewTab() {
  const { lecture, setActiveTab, jumpToSegment } = useWorkspace();

  const stats = [
    { label: "Duration", value: formatTime(lecture.duration), unit: "" },
    { label: "Chapters", value: String(lecture.segments.length), unit: "段" },
    { label: "Words", value: String(lecture.stats.words), unit: "字" },
    {
      label: "Key frames",
      value: String(lecture.stats.framesKept),
      unit: `/ ${lecture.stats.framesTotal}`,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <section>
        <div className="flex items-center gap-3">
          <span className="label-mono text-[9px]">01 · Overview</span>
          <span className="h-px flex-1 bg-border/60" aria-hidden />
          <span className="label-mono text-[9px]">{lecture.subtitle}</span>
        </div>

        <h1 className="display mt-4 text-[1.85rem] leading-[1.2] text-foreground md:text-[2.3rem]">
          {lecture.title}
        </h1>
        <p className="display-italic mt-1.5 text-[15px] text-gold/85">
          from watch → recall
        </p>
        <p className="mt-4 max-w-2xl text-[13px] leading-[1.9] text-muted-foreground md:text-sm">
          {lecture.overview.summary}
        </p>
      </section>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 md:grid-cols-4">
        {stats.map((item) => (
          <div key={item.label} className="bg-card/70 px-4 py-4">
            <div className="label-mono text-[9px]">{item.label}</div>
            <div className="mt-1.5 flex items-baseline gap-1">
              <span className="display text-[1.6rem] leading-none text-foreground">
                {item.value}
              </span>
              {item.unit ? (
                <span className="font-mono text-[10px] text-gold/80">{item.unit}</span>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="label-mono text-[9px]">02 · Key points</span>
          <span className="h-px flex-1 bg-border/60" aria-hidden />
          <span className="label-mono text-[9px]">记住这 {lecture.overview.keyPoints.length} 条</span>
        </div>
        <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/70 bg-card/40">
          {lecture.overview.keyPoints.map((point, index) => (
            <li key={point} className="flex items-start gap-4 px-4 py-3.5">
              <span className="display-italic w-5 shrink-0 text-[13px] leading-6 text-gold/60">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="text-[13px] leading-[1.8] text-foreground/90">{point}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-card/40 p-4">
          <div className="flex items-center gap-3">
            <span className="label-mono text-[9px]">03 · Start here</span>
            <span className="h-px flex-1 bg-border/60" aria-hidden />
            <ListChecks className="h-3.5 w-3.5 text-gold/70" aria-hidden />
          </div>
          <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
            建议顺序:先读讲义第 2、4 节,再做一轮测验,最后用复习队列巩固。
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("notes")}
              className="group inline-flex items-center gap-2 rounded-full bg-primary py-1 pl-4 pr-1 text-[12px] font-medium text-primary-foreground transition-colors duration-200 ease-smooth hover:bg-primary/90"
            >
              打开讲义
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-foreground/15 transition-transform duration-200 ease-smooth group-hover:rotate-45">
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("quiz")}
              className="rounded-full border border-border px-3.5 py-1.5 text-[12px] text-foreground transition-colors duration-200 ease-smooth hover:border-primary/50 hover:bg-accent"
            >
              开始测验
            </button>
            <button
              type="button"
              onClick={() => jumpToSegment((lecture.segments[1] ?? lecture.segments[0]).id)}
              className="rounded-full px-2.5 py-1.5 font-mono text-[11px] text-gold/80 transition-colors duration-200 ease-smooth hover:text-gold"
            >
              jump · ch.02
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/40 p-4">
          <div className="flex items-center gap-3">
            <span className="label-mono text-[9px]">04 · Glossary</span>
            <span className="h-px flex-1 bg-border/60" aria-hidden />
            <Quote className="h-3.5 w-3.5 text-gold/70" aria-hidden />
          </div>
          <Accordion type="single" collapsible className="mt-1">
            {lecture.overview.glossary.map((item) => (
              <AccordionItem key={item.term} value={item.term} className="border-border/50">
                <AccordionTrigger className="py-2.5 text-[13px] font-normal hover:no-underline hover:text-primary">
                  {item.term}
                </AccordionTrigger>
                <AccordionContent className="pb-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  {item.definition}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      <div className="flex items-center gap-3 pb-2">
        <BookOpen className="h-3.5 w-3.5 text-gold/60" aria-hidden />
        <span className="label-mono text-[9px]">End of overview</span>
        <span className="h-px flex-1 bg-border/50" aria-hidden />
      </div>
    </div>
  );
}

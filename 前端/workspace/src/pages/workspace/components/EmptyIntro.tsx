import {
  ArrowUpRight,
  CalendarClock,
  FileText,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Presentation,
  Waypoints,
} from "lucide-react";
import { useWorkspace } from "../hooks/use-workspace";

const CAPABILITIES = [
  {
    index: "01",
    icon: FileText,
    title: "图文混排讲义",
    body: "按章节组织的 Markdown 讲义,段落旁带时间戳,插图可放大,可导出 PDF。",
  },
  {
    index: "02",
    icon: MessageSquare,
    title: "带证据的视频问答",
    body: "基于字幕检索作答,每条结论都附时间戳引用与截图,点一下回到原片。",
  },
  {
    index: "03",
    icon: ListChecks,
    title: "测验与间隔复习",
    body: "即时反馈的选择题与复习队列,把“看懂了”推进到“说得出”。",
  },
];

const TAB_HINTS = [
  { icon: LayoutDashboard, label: "概览", body: "摘要与要点" },
  { icon: FileText, label: "讲义", body: "Markdown 正文" },
  { icon: Waypoints, label: "思维导图", body: "可折叠结构" },
  { icon: Presentation, label: "PPT", body: "去重关键帧" },
  { icon: MessageSquare, label: "问答", body: "时间戳引用" },
  { icon: ListChecks, label: "测验", body: "即时反馈" },
  { icon: CalendarClock, label: "复习", body: "间隔队列" },
  { icon: GraduationCap, label: "讲授", body: "以教代学" },
];

/** Right pane before a video is chosen: a hero, then the asset inventory. */
export function EmptyIntro() {
  const { startDemo } = useWorkspace();

  return (
    <div className="relative h-full overflow-hidden">
      <div className="ambient-glow pointer-events-none absolute inset-x-0 top-0 h-[26rem]" aria-hidden />
      <div className="relative flex h-full flex-col gap-8 p-5 md:p-8">
        <div className="max-w-2xl space-y-4">
          <div className="flex items-center gap-3">
            <span className="label-mono text-[9px]">N° 001 / Start here</span>
            <span className="h-px w-16 bg-border" aria-hidden />
            <span className="display-italic text-[13px] text-gold/80">watch → recall</span>
          </div>

          <h1 className="display text-[2rem] leading-[1.16] text-foreground md:text-[2.7rem]">
            把看完就忘的长视频,
            <br />
            变成<span className="text-gold">可检索</span>、
            <span className="text-gold">可复习</span>的知识资产
            <span className="text-primary">。</span>
          </h1>

          <p className="max-w-xl text-[13px] leading-[1.85] text-muted-foreground md:text-sm">
            Agent 会依次完成语音识别、关键帧去重与语义分段,再产出讲义、思维导图、PPT 关键帧、带时间戳的问答,以及测验与复习材料。
            解析过程中,已经完成的阶段可以先看。
          </p>

          <button
            type="button"
            onClick={startDemo}
            className="group inline-flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-4 pr-1 text-[13px] text-foreground transition-colors duration-200 ease-smooth hover:border-primary/50 hover:bg-accent"
          >
            直接使用示例视频
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-200 ease-smooth group-hover:rotate-45">
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </span>
          </button>
        </div>

        <div className="grid gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 sm:grid-cols-3">
          {CAPABILITIES.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="group relative bg-card/70 p-4 transition-colors duration-200 ease-smooth hover:bg-card"
              >
                <div className="flex items-center justify-between">
                  <span className="display-italic text-[13px] text-gold/70">{item.index}</span>
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                </div>
                <h2 className="mt-3 text-[13px] text-foreground">{item.title}</h2>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </div>
            );
          })}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="label-mono text-[9px]">03 · The eight views</span>
            <span className="h-px flex-1 bg-border/60" aria-hidden />
            <span className="label-mono text-[9px]">将依次点亮</span>
          </div>
          <ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {TAB_HINTS.map((item, index) => {
              const Icon = item.icon;
              return (
                <li key={item.label} className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                  <span className="font-mono text-[9px] text-gold/60">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="shrink-0 text-[11px] text-foreground/85">{item.label}</span>
                  <span className="truncate text-[11px] text-muted-foreground">· {item.body}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

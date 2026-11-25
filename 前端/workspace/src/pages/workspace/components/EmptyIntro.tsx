import {
  CalendarClock,
  FileText,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Presentation,
  Waypoints,
} from "lucide-react";

const CAPABILITIES = [
  {
    icon: FileText,
    title: "图文混排讲义",
    body: "按章节组织的 Markdown 讲义,段落旁带时间戳,插图可放大,可导出 PDF。",
  },
  {
    icon: MessageSquare,
    title: "带证据的视频问答",
    body: "基于字幕检索作答,每条结论都附时间戳引用与截图,点一下回到原片。",
  },
  {
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

export function EmptyIntro() {
  return <div className="mt-8 space-y-7">
    <section>
      <h2 className="mb-3 text-lg font-semibold tracking-tight">解析后可以做什么</h2>
      <ul className="study-features grid gap-3 sm:grid-cols-3">{CAPABILITIES.map(({icon: Icon, title, body})=>
        <li key={title} className="rounded-xl border border-border bg-card p-4">
          <Icon size={19} className="mb-3 text-primary"/><h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
        </li>)}</ul>
    </section>
    <section>
      <h2 className="mb-2 text-lg font-semibold tracking-tight">学习视图</h2>
      <ul className="grid gap-x-8 sm:grid-cols-2">{TAB_HINTS.map(({icon: Icon,label,body})=>
        <li key={label} className="flex items-center gap-2.5 border-b border-border py-2.5 text-sm">
          <Icon size={15} className="shrink-0 text-muted-foreground"/>{label}<span className="ml-auto text-xs text-muted-foreground">{body}</span>
        </li>)}</ul>
    </section>
  </div>;
}

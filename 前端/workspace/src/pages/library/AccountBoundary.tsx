import { useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatTime } from "@/lib/format";
import { workspaceUsername } from "@/lib/api";
import { WorkspaceAccount } from "./WorkspaceAccount";
import { DEMO_LECTURE } from "../workspace/data/lecture";
import { PlayerControls } from "../workspace/components/PlayerControls";
import { usePlayer } from "../workspace/hooks/use-player";
import { usePlayerShortcuts } from "../workspace/hooks/use-player-shortcuts";
import { PlaybackContext } from "../workspace/workspace-context";

function DemoControls() {
  usePlayerShortcuts(true);
  return <PlayerControls/>;
}

function PublicDemo() {
  const {title, duration, slides} = DEMO_LECTURE;
  const mediaRef = useRef<HTMLVideoElement>(null);
  const player = usePlayer({mode: "mock", duration, mediaRef, sourceKey: "public-demo"});
  const slide = slides.reduce((current, next) => next.time <= player.currentTime ? next : current, slides[0]);

  return <main className="h-dvh overflow-y-auto bg-background px-4 py-8 text-foreground sm:px-8">
    <div className="mx-auto max-w-5xl">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <span className="font-mono text-sm tracking-widest">VideoParse</span><WorkspaceAccount/>
      </header>
      <p className="mb-2 text-sm font-medium text-primary">示例课程</p>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="my-3 text-sm text-muted-foreground">登录后可上传视频和 Markdown，使用自己的资料库。</p>
      <section aria-label="示例视频" className="mt-6 grid overflow-hidden rounded-2xl border bg-card md:grid-cols-[2fr_1fr]">
        <div className="min-w-0">
          <img className="aspect-video w-full bg-muted object-contain" src={slide.image} alt={slide.title}/>
          <div className="p-4">
            <PlaybackContext.Provider value={{...player, duration}}><DemoControls/></PlaybackContext.Provider>
            <p className="mt-3 text-sm text-muted-foreground">{slide.caption}</p>
          </div>
        </div>
        <nav aria-label="示例视频关键帧" className="space-y-1 border-t border-border p-4 md:border-l md:border-t-0">
          <h2 className="mb-3 text-sm font-semibold">关键帧</h2>
          {slides.map(item => <button key={item.id} type="button" aria-current={item === slide ? "time" : undefined}
            className="flex w-full items-baseline gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-accent aria-[current=time]:bg-primary/10 aria-[current=time]:text-primary"
            onClick={() => player.seek(item.time)}>
            <span className="font-mono text-xs tabular-nums">{formatTime(item.time)}</span>{item.title}
          </button>)}
        </nav>
      </section>
    </div>
  </main>;
}

export function AccountBoundary({children}: {children: ReactNode}) {
  const account = useQuery({queryKey: ["workspace-account"], queryFn: workspaceUsername, retry: false, networkMode: "always"});
  if (account.isPending) return <p role="status" className="p-6 text-sm text-muted-foreground">正在打开工作台…</p>;
  if (account.isError || !account.data) return <PublicDemo/>;
  return children;
}

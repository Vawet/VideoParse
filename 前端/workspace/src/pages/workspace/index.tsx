import type { ArchivedVideo } from "@/lib/api";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { AppHeader } from "./components/AppHeader";
import { EmptyIntro } from "./components/EmptyIntro";
import { ParseStatusBar } from "./components/ParseStatusBar";
import { PrintNotes } from "./components/PrintNotes";
import { ResultTabs } from "./components/ResultTabs";
import { SlideLightbox } from "./components/SlideLightbox";
import { UploadDropzone } from "./components/UploadDropzone";
import { BilibiliImport } from "./components/Bilibili";
import { VideoPane } from "./components/VideoPane";
import { usePlayerShortcuts } from "./hooks/use-player-shortcuts";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { usePlayback, useWorkspace } from "./hooks/use-workspace";
import { WorkspaceProvider } from "./workspace-provider";

/** Single-page workbench: header, video column on the left, results on the right. */
function WorkspaceShell({active}: {active: boolean}) {
  const { status } = useWorkspace();
  const {playing, toggle} = usePlayback();
  useEffect(() => { if (!active && playing) toggle(); }, [active, playing, toggle]);
  usePlayerShortcuts(active && (status === "parsing" || status === "ready" || status === "failed"));

  const [params] = useSearchParams();
  const navigate = useNavigate();
  const adding = active && params.get("add") === "video";
  if (adding && status === "uploading") return <div className="p-6 text-sm">
    当前视频正在上传。<Link className="text-primary underline" to="/">查看上传进度</Link>
  </div>;
  if (status === "empty" || adding) {
    return (
      <div className="study-home vp-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1020px] px-5 py-7 sm:px-9 sm:py-9 xl:px-12">
          <h1 className="display text-[1.9rem] leading-[1.2] sm:text-[2.7rem]">
            把看完就忘的长视频，<br/>
            变成<span className="text-gold">可检索</span>、<span className="text-gold">可复习</span>的<span className="inline-block">知识资产<span className="text-primary">。</span></span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">导入课程或讲座，Agent 会转写语音、筛选关键帧并划分章节。解析时就能查看已完成的讲义、导图和复习材料。</p>
          <UploadDropzone onStart={adding ? () => void navigate("/", {replace: true}) : undefined}/>
          {import.meta.env.VITE_PLATFORM === "true" && <BilibiliImport onStart={adding ? () => void navigate("/", {replace: true}) : undefined}/>}
          <EmptyIntro />
        </div>
      </div>
    );
  }

  const results = (
    <div className="flex min-h-0 flex-1 flex-col">
      <ParseStatusBar />
      <ResultTabs />
    </div>
  );

  return <div className="study-reader flex min-h-0 min-w-0 flex-1">
    <ResizablePanelGroup direction="horizontal" className="study-panels vp-scroll min-h-0 flex-1">
      <ResizablePanel defaultSize={40} minSize={30} className="study-media-panel flex min-h-0 flex-col">
        <VideoPane />
      </ResizablePanel>
      <ResizableHandle withHandle className="study-divider" />
      <ResizablePanel defaultSize={60} minSize={36} className="flex min-h-0 flex-col">
        {results}
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>;
}

const Workspace = ({archive, active = true}: {archive?: ArchivedVideo; active?: boolean}) => (
  <WorkspaceProvider archive={archive}>
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="ambient-glow pointer-events-none absolute inset-x-0 top-0 h-80 opacity-70" aria-hidden/>
      <AppHeader />
      <main className="relative flex min-h-0 flex-1 flex-col">
        <WorkspaceShell active={active}/>
      </main>
      <SlideLightbox />
      <PrintNotes />
    </div>
  </WorkspaceProvider>
);

export default Workspace;

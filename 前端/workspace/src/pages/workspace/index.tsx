import type { ArchivedVideo } from "@/lib/api";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { AppHeader } from "./components/AppHeader";
import { ParseStatusBar } from "./components/ParseStatusBar";
import { PrintNotes } from "./components/PrintNotes";
import { ResultTabs } from "./components/ResultTabs";
import { SlideLightbox } from "./components/SlideLightbox";
import { UploadDropzone } from "./components/UploadDropzone";
import { KeyframePreview } from "./components/KeyframePreview";
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
  usePlayerShortcuts(active && status !== "empty" && status !== "uploading");

  const [params] = useSearchParams();
  const navigate = useNavigate();
  const adding = active && params.get("add") === "video";
  if (adding && status === "uploading") return <div className="p-6 text-sm">
    当前视频正在上传。<Link className="text-primary underline" to="/">查看上传进度</Link>
  </div>;
  if (status === "empty" || adding) {
    return (
      <div className="study-home vp-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="home-content">
          <header className="home-heading">
            <h1>学习工作台</h1>
            <p>导入视频，生成图文讲义、思维导图和复习材料。</p>
          </header>
          <UploadDropzone onStart={adding ? () => void navigate("/", {replace: true}) : undefined}/>
          {import.meta.env.VITE_PLATFORM === "true" && <BilibiliImport onStart={adding ? () => void navigate("/", {replace: true}) : undefined}/>}
          <KeyframePreview/>
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

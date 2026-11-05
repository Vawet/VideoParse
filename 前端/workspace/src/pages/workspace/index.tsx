import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import { AppHeader } from "./components/AppHeader";
import { ChapterList } from "./components/ChapterList";
import { EmptyIntro } from "./components/EmptyIntro";
import { ParseStatusBar } from "./components/ParseStatusBar";
import { PlayerSurface } from "./components/PlayerSurface";
import { PrintNotes } from "./components/PrintNotes";
import { ResultTabs } from "./components/ResultTabs";
import { SlideLightbox } from "./components/SlideLightbox";
import { UploadDropzone } from "./components/UploadDropzone";
import { VideoPane } from "./components/VideoPane";
import { usePlayerShortcuts } from "./hooks/use-player-shortcuts";
import { useWorkspace } from "./hooks/use-workspace";
import { WorkspaceProvider } from "./workspace-provider";

/** Single-page workbench: header, video column on the left, results on the right. */
function WorkspaceShell() {
  const { status } = useWorkspace();
  const isMobile = useIsMobile();
  usePlayerShortcuts(status === "parsing" || status === "ready" || status === "failed");

  if (status === "empty") {
    return (
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 flex-col border-b border-border md:w-2/5 md:min-w-[340px] md:border-b-0 md:border-r">
          <UploadDropzone />
        </div>
        <div className="vp-scroll min-h-0 flex-1 overflow-y-auto">
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

  if (isMobile) {
    return (
      <div className="vp-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-30 border-b border-border bg-background p-3 pb-2 shadow-soft">
          <PlayerSurface />
        </div>
        <div className="flex min-h-0 flex-col p-3">
          <ChapterList />
        </div>
        {results}
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
      <ResizablePanel defaultSize={40} minSize={30} className="flex min-h-0 flex-col">
        <VideoPane />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={60} minSize={36} className="flex min-h-0 flex-col">
        {results}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

const Workspace = () => (
  <WorkspaceProvider>
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="ambient-glow pointer-events-none absolute inset-x-0 top-0 h-80 opacity-70" aria-hidden />
      <AppHeader />
      <main className="relative flex min-h-0 flex-1 flex-col">
        <WorkspaceShell />
      </main>
      <SlideLightbox />
      <PrintNotes />
    </div>
  </WorkspaceProvider>
);

export default Workspace;

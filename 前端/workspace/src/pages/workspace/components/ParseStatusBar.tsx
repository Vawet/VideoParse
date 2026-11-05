import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  UploadCloud,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../hooks/use-workspace";
import { AgentTimeline } from "./AgentTimeline";

/** Parse status strip above the result tabs: upload, progress, failure and summary. */
export function ParseStatusBar() {
  const {
    status,
    progress,
    uploadProgress,
    fileMeta,
    activeStep,
    failure,
    lecture,
    available,
    cancelUpload,
    retry,
    clearProject,
  } = useWorkspace();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (status === "parsing") setOpen(true);
    if (status === "ready") setOpen(false);
  }, [status]);

  if (status === "empty") return null;

  return (
    <div className="shrink-0 space-y-2 px-3 pt-3 md:px-5">
      {status === "uploading" ? (
        <div className="rounded-xl border border-border/70 bg-card/50 p-3.5">
          <div className="flex items-center gap-2.5">
            <UploadCloud className="h-3.5 w-3.5 text-gold" aria-hidden />
            <span className="truncate text-[13px] text-foreground">{fileMeta?.name ?? "视频文件"}</span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-gold">
              {Math.round(uploadProgress)}%
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-full"
              onClick={cancelUpload}
              aria-label="取消上传"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
          <Progress value={uploadProgress} className="mt-2.5 h-1" />
          <p className="label-mono mt-2 text-[8px]">
            {fileMeta ? `${formatBytes(fileMeta.size)} · 上传完成后自动开始解析` : "正在上传"}
          </p>
        </div>
      ) : null}

      {status === "parsing" ? (
        <div className="rounded-xl border border-border/70 bg-card/50 px-3.5 py-2.5">
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
            <span className="text-[13px] text-foreground">{activeStep?.label ?? "解析中"}</span>
            <span className="font-mono text-[11px] tabular-nums text-primary">
              {String(Math.round(progress * 100)).padStart(2, "0")}%
            </span>
            <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">
              {available.chapters ? "章节与问答已可用,其余标签仍在生成" : "正在准备第一批结果"}
            </span>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-1 transition-colors duration-200 ease-smooth hover:bg-accent"
            >
              <span className="label-mono text-[8px]">Timeline</span>
              <ChevronDown
                className={`h-3 w-3 text-muted-foreground transition-transform duration-200 ease-smooth ${open ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
          </div>
          <Progress value={Math.round(progress * 100)} className="mt-2.5 h-1" />
        </div>
      ) : null}

      {status === "failed" && failure ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive-soft p-3.5 text-destructive-soft-foreground"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">解析在「讲义生成」阶段失败</p>
              <p className="mt-1 text-[11px] leading-relaxed opacity-90">{failure.reason}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={retry} className="h-8 gap-1.5 rounded-full">
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  重试这一步
                </Button>
                <button
                  type="button"
                  onClick={clearProject}
                  className="rounded-full border border-destructive/30 px-3 py-1.5 text-[11px] text-destructive-soft-foreground transition-colors duration-200 ease-smooth hover:bg-destructive/10"
                >
                  换一个视频
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {status === "ready" ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-card/50 px-3.5 py-2.5 text-left transition-colors duration-200 ease-smooth hover:border-border hover:bg-accent/40"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span className="label-mono text-[9px] text-foreground">Parsed</span>
          <span className="truncate text-[11px] text-muted-foreground">
            {lecture.segments.length} 章节 · {lecture.slides.length} 幻灯片 · {lecture.stats.words} 字讲义
          </span>
          <ChevronDown
            className={cn(
              "ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-smooth",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      ) : null}

      {(status === "parsing" || status === "ready" || status === "failed") && (
        <AgentTimeline open={open} onOpenChange={setOpen} />
      )}
    </div>
  );
}

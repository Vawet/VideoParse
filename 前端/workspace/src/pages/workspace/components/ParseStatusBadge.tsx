import { cn } from "@/lib/utils";
import { useWorkspace } from "../hooks/use-workspace";

const DOT = {
  uploading: "bg-muted-foreground",
  parsing: "bg-warning animate-live-pulse",
  pausing: "bg-warning",
  paused: "bg-muted-foreground",
  ready: "bg-primary",
  failed: "bg-destructive",
} as const;

const TEXT = {
  uploading: "text-muted-foreground",
  parsing: "text-warning-soft-foreground",
  pausing: "text-warning-soft-foreground",
  paused: "text-muted-foreground",
  ready: "text-primary-soft-foreground",
  failed: "text-destructive-soft-foreground",
} as const;

/** Video state in the header: a dot and a mono label, in the language of the reference. */
export function ParseStatusBadge() {
  const { status, progress, uploadProgress } = useWorkspace();

  if (status === "empty") {
    return (
      <span className="hidden items-center gap-2 rounded-full border border-border/80 px-2.5 py-1 sm:inline-flex">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" aria-hidden />
        <span className="label-mono text-[9px]">Awaiting video</span>
      </span>
    );
  }

  const label = {
    uploading: `上传中 ${Math.round(uploadProgress)}%`,
    parsing: `解析中 ${Math.round(progress * 100)}%`,
    pausing: "正在暂停",
    paused: "已暂停",
    ready: "已完成",
    failed: "解析失败",
  }[status];

  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border/80 bg-card/60 px-2.5 py-1"
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[status])} aria-hidden />
      <span className={cn("font-mono text-[10px] uppercase tracking-[0.16em]", TEXT[status])}>
        {label}
      </span>
    </span>
  );
}

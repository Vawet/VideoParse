import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "../hooks/use-workspace";

/** Shown in a tab whose result group the parse run has not unlocked yet. */
export function TabPlaceholder({ label, unsupported }: { label: string; unsupported?: boolean }) {
  const { activeStep, status, retry } = useWorkspace();

  if (unsupported) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-gradient-surface p-8 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <p className="text-sm text-foreground">「{label}」暂未接入真实视频</p>
        <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">
          这个功能目前只在示例视频里可用。概览、讲义、思维导图、PPT 与问答都来自你上传的视频。
        </p>
      </div>
    );
  }

  if (status === "paused") return <p className="p-6 text-center text-sm text-muted-foreground">继续解析后将生成「{label}」。</p>;

  if (status === "failed") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-destructive/35 bg-destructive-soft/40 p-8 text-center">
        <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
        <p className="text-sm text-foreground">解析中断,「{label}」还没有生成</p>
        <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">
          已完成的章节、幻灯片与问答结果仍然可以查看;重试会从中断的那一步继续。
        </p>
        <Button size="sm" className="mt-1 rounded-full" onClick={retry}>
          重试解析
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-gradient-surface p-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/30 bg-gold-soft text-gold">
        <Sparkles className="h-4 w-4" aria-hidden />
      </span>
      <p className="text-sm text-foreground">「{label}」正在生成</p>
      <p className="flex items-center gap-1.5 label-mono text-[9px]">
        {activeStep ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-primary" aria-hidden />
            {activeStep.label}
          </>
        ) : (
          "等待解析开始"
        )}
      </p>
      <div className="mt-1 w-full max-w-sm space-y-2">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className={`h-2.5 rounded-sm bg-border/60 ${row === 1 ? "w-4/5" : row === 2 ? "w-3/5" : "w-full"}`}
          />
        ))}
      </div>
    </div>
  );
}

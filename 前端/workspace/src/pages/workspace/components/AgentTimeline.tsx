import { AlertTriangle, CheckCircle2, ChevronDown, Circle, Loader2, Pause } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../hooks/use-workspace";

type AgentTimelineProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** The six-stage agent run, collapsible, with one line of explanation per stage. */
export function AgentTimeline({ open, onOpenChange }: AgentTimelineProps) {
  const { steps, stepStatus, progress, status } = useWorkspace();
  const doneCount = steps.filter((step) => stepStatus(step) === "done").length;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card/40">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-200 ease-smooth hover:bg-accent/40"
          >
            <span className="label-mono text-[9px] text-gold/80">Agent</span>
            <span className="h-px w-5 bg-border" aria-hidden />
            <span className="text-[12px] text-foreground">解析时间线</span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {String(doneCount).padStart(2, "0")}/{String(steps.length).padStart(2, "0")}
            </span>
            <ChevronDown
              className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ease-smooth group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-2 border-t border-border/60 px-3.5 pb-3 pt-3">
            <Progress value={Math.round(progress * 100)} className="h-1" />
            <ol className="pt-1">
              {steps.map((step, index) => {
                const state = stepStatus(step);
                const detail =
                  state === "done"
                    ? step.doneDetail
                    : state === "active"
                      ? status === "paused" ? "已暂停，等待继续解析" : step.detail
                      : state === "failed"
                        ? "这一步中断了,结果保留在上一步。"
                        : "等待前一步完成";
                return (
                  <li key={step.id} className="relative flex gap-3 pb-3 last:pb-0">
                    {index < steps.length - 1 ? (
                      <span
                        className="absolute left-[7px] top-6 h-[calc(100%-0.75rem)] w-px bg-border/70"
                        aria-hidden
                      />
                    ) : null}
                    <span className="relative z-10 mt-0.5 bg-card">
                      {state === "done" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden />
                      ) : state === "active" ? (
                        status === "paused" ? <Pause size={14} aria-hidden/> : <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" aria-hidden />
                      ) : state === "failed" ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-hidden />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-muted-foreground/35" aria-hidden />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "text-[12px]",
                            state === "pending" ? "text-muted-foreground" : "text-foreground",
                          )}
                        >
                          {step.label}
                        </span>
                        {state === "active" ? (
                          <span className="font-mono text-[10px] tabular-nums text-gold">
                            {String(Math.round(progress * 100)).padStart(2, "0")}%
                          </span>
                        ) : null}
                        {state === "failed" ? (
                          <span className="rounded-full border border-destructive/35 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-destructive-soft-foreground">
                            中断
                          </span>
                        ) : null}
                        {state === "done" ? (
                          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">
                            done
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {detail}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {status === "ready" ? (
              <p className="label-mono border-t border-border/60 pt-2 text-[8px]">
                全部 6 步完成 · 结果已就地可用
              </p>
            ) : null}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

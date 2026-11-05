import { useState } from "react";
import { CalendarClock, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatInterval, toPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReviewOutcome } from "../hooks/use-review-session";
import { useWorkspace } from "../hooks/use-workspace";
import { TimestampChip } from "../components/TimestampChip";

const OUTCOME_META: Record<ReviewOutcome, { label: string; className: string }> = {
  forgot: { label: "忘记", className: "bg-destructive-soft text-destructive-soft-foreground" },
  shaky: { label: "模糊", className: "bg-warning-soft text-warning-soft-foreground" },
  known: { label: "记住", className: "bg-success-soft text-success-soft-foreground" },
};

export function ReviewTab() {
  const { lecture, review, seekTo } = useWorkspace();
  const [revealed, setRevealed] = useState(false);

  const card = review.pending[0];
  const segment = card ? lecture.segments.find((item) => item.id === card.segmentId) : undefined;
  const reviewedCount = review.total - review.pending.length;

  const grade = (outcome: ReviewOutcome) => {
    if (!card) return;
    review.grade(card, outcome);
    setRevealed(false);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-xl border border-border/70 bg-card/40 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <CalendarClock className="h-3 w-3 text-gold/80" aria-hidden />
          <span className="label-mono text-[9px]">01 · Review</span>
          <span className="text-[11px] text-muted-foreground">
            剩余 {review.pending.length} 张 · 已掌握 {review.masteredCount} 张
          </span>
          <span className="ml-auto flex items-baseline gap-1">
            <span className="display text-[20px] leading-none text-gold">{reviewedCount}</span>
            <span className="font-mono text-[9px] text-muted-foreground">/ {review.total}</span>
          </span>
        </div>
        <Progress value={toPercent(reviewedCount, review.total)} className="mt-2 h-1" />
      </div>

      {card ? (
        <div className="rounded-xl border border-border/70 bg-card/40 p-4 shadow-soft md:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {segment?.title ?? "复习卡片"}
            </span>
            <TimestampChip
              seconds={card.time}
              onJump={(seconds) => seekTo(seconds, { segmentId: card.segmentId })}
            />
          </div>

          <h2 className="mt-3 text-base font-medium leading-relaxed">{card.prompt}</h2>

          {revealed ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-md border border-primary/25 bg-primary-soft p-3">
                <p className="text-xs font-medium text-primary-soft-foreground">答案</p>
                <p className="mt-1 text-sm leading-relaxed">{card.answer}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">这次记得怎么样?</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => grade("forgot")}
                  className="rounded-full border-destructive/30 text-destructive-soft-foreground"
                >
                  忘记(明天再看)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => grade("shaky")}
                >
                  模糊(几天后再看)
                </Button>
                <Button size="sm" className="rounded-full" onClick={() => grade("known")}>
                  记住(拉长间隔)
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" onClick={() => setRevealed(true)}>
                显示答案
              </Button>
              <span className="text-xs text-muted-foreground">
                先在心里复述一遍,再对照答案
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border/70 bg-card/40 p-5 text-center shadow-soft">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <h2 className="mt-3 text-base font-medium">本轮复习完成</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            共复习 {reviewedCount} 张卡片,其中 {review.masteredCount} 张标记为已掌握。
          </p>
          <Button size="sm" variant="outline" className="mt-3 gap-1.5" onClick={review.restart}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            重新复习一轮
          </Button>
        </div>
      )}

      {review.graded.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">本次反馈</h3>
          <ul className="space-y-1.5">
            {review.graded.map((item) => (
              <li
                key={item.card.id}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
              >
                <span className="truncate text-xs">{item.card.prompt}</span>
                <span
                  className={cn(
                    "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    OUTCOME_META[item.outcome].className,
                  )}
                >
                  {OUTCOME_META[item.outcome].label}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  下次 {formatInterval(item.nextIntervalDays * 24 * 60)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        间隔按 SM-2 的简化规则推算:忘记会缩短间隔,模糊略微拉长,记住则把间隔翻倍以上。
      </p>
    </div>
  );
}

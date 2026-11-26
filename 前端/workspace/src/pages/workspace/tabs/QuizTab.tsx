import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, CircleCheck, HelpCircle, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { toPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../hooks/use-workspace";
import { TimestampChip } from "../components/TimestampChip";

export function QuizTab() {
  const { lecture, quiz, seekTo } = useWorkspace();
  const [index, setIndex] = useState(0);
  const [shortDraft, setShortDraft] = useState("");

  const question = lecture.quiz[index];
  const answer = quiz.answers[question.id];
  const segment = lecture.segments.find((item) => item.id === question.segmentId);
  const accuracy = quiz.answeredCount === 0 ? 0 : toPercent(quiz.correctCount, quiz.answeredCount);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-xl border border-border/70 bg-card/40 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tool-heading">测验进度</span>
          <span className="text-[11px] text-muted-foreground">
            已答 {quiz.answeredCount} / {quiz.total} 题 · 正确 {quiz.correctCount} 题
          </span>
          <span className="ml-auto flex items-baseline gap-1">
            <span className="display text-[20px] leading-none text-gold">{accuracy}</span>
            <span className="font-mono text-[9px] text-muted-foreground">% ACC</span>
          </span>
        </div>
        <Progress value={toPercent(quiz.answeredCount, quiz.total)} className="mt-2 h-1" />
      </div>

      <div className="rounded-xl border border-border/70 bg-card/40 p-4 shadow-soft md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            第 {index + 1} 题 / {quiz.total}
          </span>
          <span className="rounded-full border border-gold/25 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-gold/85">
            {question.kind === "choice" ? "单选题" : "简答题"}
          </span>
          {segment ? (
            <>
              <span className="truncate text-[11px] text-muted-foreground">{segment.title}</span>
              <TimestampChip
                seconds={question.time}
                onJump={(seconds) => seekTo(seconds, { segmentId: question.segmentId })}
              />
            </>
          ) : null}
        </div>

        <h2 className="mt-3 text-base font-medium leading-relaxed">{question.question}</h2>

        {question.kind === "choice" ? (
          <ul className="mt-4 space-y-2">
            {question.options?.map((option) => {
              const chosen = answer?.choiceId === option.id;
              const isCorrect = option.id === question.answerId;
              const revealed = Boolean(answer?.choiceId);
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    disabled={revealed}
                    onClick={() => quiz.choose(question.id, option.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md border p-3 text-left text-sm transition-colors duration-200 ease-smooth",
                      revealed && isCorrect
                        ? "border-success/40 bg-success-soft text-success-soft-foreground"
                        : revealed && chosen
                          ? "border-destructive/40 bg-destructive-soft text-destructive-soft-foreground"
                          : revealed
                            ? "border-border opacity-70"
                            : "border-border hover:border-primary/40 hover:bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                        revealed && isCorrect
                          ? "border-success bg-success text-success-foreground"
                          : revealed && chosen
                            ? "border-destructive bg-destructive text-destructive-foreground"
                            : "border-border text-gold",
                      )}
                    >
                      {revealed && isCorrect ? (
                        <Check className="h-3 w-3" aria-hidden />
                      ) : revealed && chosen ? (
                        <X className="h-3 w-3" aria-hidden />
                      ) : (
                        option.id.toUpperCase()
                      )}
                    </span>
                    {option.label}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-4 space-y-3">
            <Textarea
              value={shortDraft}
              onChange={(event) => setShortDraft(event.target.value)}
              placeholder="用自己的话写下答案,再看参考答案对照。"
              rows={4}
              aria-label="简答题作答"
              disabled={Boolean(answer?.correct) || Boolean(answer?.revealedShort)}
            />
            {!answer?.revealedShort ? (
              <Button size="sm" variant="outline" onClick={() => quiz.revealShort(question.id)}>
                查看参考答案
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="rounded-md border border-primary/25 bg-primary-soft p-3">
                  <p className="text-xs font-medium text-primary-soft-foreground">参考答案</p>
                  <p className="mt-1 text-sm leading-relaxed">{question.modelAnswer}</p>
                </div>
                {answer.correct === undefined ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">对照之后:</span>
                    <Button size="sm" className="gap-1.5" onClick={() => quiz.gradeShort(question.id, true)}>
                      <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                      我答对了
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => quiz.gradeShort(question.id, false)}
                    >
                      没答全,进复习
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {answer?.choiceId || answer?.correct !== undefined ? (
          <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-border pt-3">
            {answer.correct ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            ) : (
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">{question.explanation}</p>
            <TimestampChip
              seconds={question.time}
              onJump={(seconds) => seekTo(seconds, { segmentId: question.segmentId })}
              className="ml-auto"
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 rounded-full"
          disabled={index === 0}
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          上一题
        </Button>
        <Button
          size="sm"
          className="gap-1.5 rounded-full"
          disabled={index >= lecture.quiz.length - 1}
          onClick={() => setIndex((value) => Math.min(lecture.quiz.length - 1, value + 1))}
        >
          下一题
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 rounded-full"
          onClick={() => {
            quiz.restart();
            setIndex(0);
            setShortDraft("");
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          重做本轮
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          答错的题目会出现在复习队列的末尾
        </span>
      </div>
    </div>
  );
}

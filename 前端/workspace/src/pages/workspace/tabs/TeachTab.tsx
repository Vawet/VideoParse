import { useEffect, useRef, useState } from "react";
import { Check, GraduationCap, Loader2, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { TEACH_CONCEPTS, gradeTeaching, type TeachFeedback } from "../data/teach";
import { useWorkspace } from "../hooks/use-workspace";
import { TimestampChip } from "../components/TimestampChip";

const MIN_LENGTH = 20;

/** Learning by teaching: explain the concept yourself, then get graded feedback. */
export function TeachTab() {
  const { lecture, seekTo } = useWorkspace();
  const [conceptId, setConceptId] = useState(TEACH_CONCEPTS[0].id);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<TeachFeedback | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const concept = TEACH_CONCEPTS.find((item) => item.id === conceptId) ?? TEACH_CONCEPTS[0];
  const segment = lecture.segments.find((item) => item.id === concept.segmentId);
  const tooShort = draft.trim().length < MIN_LENGTH;

  const submit = () => {
    if (tooShort || busy) return;
    setBusy(true);
    setFeedback(null);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setFeedback(gradeTeaching(draft, concept));
      setBusy(false);
    }, 1500);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-xl border border-border/70 bg-card/40 p-4">
        <div className="flex items-center gap-3">
          <span className="label-mono text-[9px]">01 · Teach back</span>
          <span className="h-px flex-1 bg-border/60" aria-hidden />
          <GraduationCap className="h-3.5 w-3.5 text-gold/70" aria-hidden />
        </div>
        <h2 className="mt-2.5 text-[13px] text-foreground">讲一遍,才算真的懂</h2>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          选一个知识点,用你自己的话讲清楚它是什么、为什么需要、怎么工作。AI 会对照这段视频的知识库,告诉你哪些要点讲到了、哪些被跳过。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TEACH_CONCEPTS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setConceptId(item.id);
                setFeedback(null);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[11px] transition-colors duration-200 ease-smooth",
                item.id === concept.id
                  ? "border-primary/50 bg-primary-soft font-medium text-primary-soft-foreground"
                  : "border-border/70 hover:border-primary/40 hover:bg-accent",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/40 p-4 shadow-soft">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{concept.label}</span>
          {segment ? (
            <span className="truncate text-[11px] text-muted-foreground">
              出自「{segment.title}」
            </span>
          ) : null}
          <TimestampChip
            seconds={concept.time}
            onJump={(seconds) => seekTo(seconds, { segmentId: concept.segmentId })}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          至少要覆盖 {concept.points.length} 个要点:{concept.points.map((point) => point.label).join("、")}
        </p>

        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={6}
          aria-label="你的讲解"
          placeholder={`例如:${concept.label}是……它解决的问题是……`}
          className="mt-3 resize-y"
        />
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {tooShort ? `再写 ${MIN_LENGTH - draft.trim().length} 个字就能提交` : `已写 ${draft.trim().length} 字`}
          </span>
          <Button size="sm" className="ml-auto gap-1.5" onClick={submit} disabled={tooShort || busy}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden />
            )}
            提交讲解
          </Button>
        </div>
      </div>

      {busy ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card/40 p-4 text-[12px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
          正在对照知识库评估你的讲解,检查要点覆盖与因果关系…
        </div>
      ) : null}

      {feedback ? (
        <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 p-4 shadow-soft">
          <div className="flex items-center gap-4">
            <div
              className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
              style={{
                background: `conic-gradient(hsl(var(--primary)) ${feedback.score * 3.6}deg, hsl(var(--muted)) 0deg)`,
              }}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card font-mono text-sm font-semibold tabular-nums">
                {feedback.score}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">讲解完成度 {feedback.score} 分</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                覆盖 {feedback.covered.length} / {concept.points.length} 个要点
                {feedback.score >= 80
                  ? ",已经可以讲给别人听了。"
                  : ",补齐下面的遗漏要点会更完整。"}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-success/25 bg-success-soft/60 p-3">
              <p className="text-xs font-medium text-success-soft-foreground">已经讲到</p>
              <ul className="mt-1.5 space-y-1">
                {feedback.covered.length === 0 ? (
                  <li className="text-xs text-muted-foreground">还没有覆盖到要点</li>
                ) : (
                  feedback.covered.map((item) => (
                    <li key={item} className="flex gap-1.5 text-xs leading-relaxed">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                      {item}
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="rounded-md border border-warning/25 bg-warning-soft/60 p-3">
              <p className="text-xs font-medium text-warning-soft-foreground">还没讲到</p>
              <ul className="mt-1.5 space-y-1">
                {feedback.missed.length === 0 ? (
                  <li className="flex gap-1.5 text-xs leading-relaxed">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                    全部要点都覆盖了
                  </li>
                ) : (
                  feedback.missed.map((item) => (
                    <li key={item.label} className="flex gap-1.5 text-xs leading-relaxed">
                      <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                      <span>
                        <span className="font-medium">{item.label}</span>
                        <span className="text-muted-foreground"> · {item.hint}</span>
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>

          <div className="rounded-md bg-muted/60 p-3">
            <p className="text-xs font-medium">下一步建议</p>
            <ul className="mt-1.5 space-y-1">
              {feedback.suggestions.map((suggestion) => (
                <li key={suggestion} className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" aria-hidden />
                  {suggestion}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => seekTo(concept.time, { segmentId: concept.segmentId })}
            >
              回到视频这一段再看一遍
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => {
                setFeedback(null);
                setDraft("");
              }}
            >
              重新讲一次
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import EvidencePanel from "../components/EvidencePanel";
import { Eraser, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EXAMPLE_QUESTIONS } from "../data/qa";
import { useWorkspace } from "../hooks/use-workspace";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { TimestampChip } from "../components/TimestampChip";

/** Subtitle-grounded Q&A: every answer carries timestamp chips and key-frame evidence. */
export function ChatTab() {
  const { lecture, messages, chatBusy, ask, clearChat, seekTo, jumpToSlide, isLive, videoId } =
    useWorkspace();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = (question: string) => {
    if (!question.trim() || chatBusy) return;
    ask(question);
    setDraft("");
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3">
      {isLive && videoId && import.meta.env.VITE_PLATFORM === "true" && <EvidencePanel video={videoId} seek={seekTo} />}
      <div className="flex items-center gap-2.5">
        <span className="label-mono text-[9px]">01 · Chat</span>
        <span className="h-px w-6 bg-border" aria-hidden />
        <h2 className="text-[13px] text-foreground">视频问答</h2>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          {isLive ? "视频证据与联网资料" : "基于 1,248 条字幕片段检索"}
        </span>
        {messages.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto gap-1.5"
            onClick={clearChat}
            disabled={chatBusy}
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden />
            清空对话
          </Button>
        ) : null}
      </div>

      <div ref={scrollRef} className="vp-scroll min-h-[18rem] flex-1 space-y-4 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 p-4">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              问视频内容可查看对应时间戳。想找课外资料，可以问“有哪些相关论文”或搜索某项技术的官方文档。
            </p>
            <div className="flex flex-wrap gap-2">
              {(isLive ? [] : EXAMPLE_QUESTIONS).map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => submit(question)}
                  className="rounded-full border border-border/70 bg-card/50 px-3 py-1.5 text-[11px] text-foreground/85 transition-colors duration-200 ease-smooth hover:border-primary/50 hover:bg-accent hover:text-foreground"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-[13px] leading-relaxed text-primary-foreground">
                {message.question}
              </p>
            </div>
          ) : message.status === "pending" ? (
            <div
              key={message.id}
              className="max-w-[92%] space-y-2 rounded-2xl rounded-bl-sm border border-border/70 bg-card/50 p-4"
            >
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex gap-1" aria-hidden>
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="h-1.5 w-1.5 animate-dot-pulse rounded-full bg-primary"
                      style={{ animationDelay: `${dot * 0.15}s` }}
                    />
                  ))}
                </span>
                正在选择来源并查找依据…
              </p>
              <div className="space-y-2">
                <div className="h-3 w-11/12 rounded bg-border/70" />
                <div className="h-3 w-4/5 rounded bg-border/70" />
                <div className="h-16 w-full rounded bg-border/40" />
              </div>
            </div>
          ) : (
            <div
              key={message.id}
              className="max-w-[92%] space-y-2.5 rounded-2xl rounded-bl-sm border border-border/70 bg-card/60 p-4 shadow-soft"
            >
              {message.answer?.webSources ? (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold">联网资料</h3>
                  <p className="text-sm">{message.answer.text}</p>
                  <ol className="space-y-2">
                    {message.answer.webSources.map((source, index) => (
                      <li key={source.url} className="border-l-2 border-primary/30 pl-3">
                        <a className="text-sm text-primary underline" href={source.url} target="_blank" rel="noopener noreferrer">[{index + 1}] {source.title}</a>
                        {index > 0 && <p className="text-xs text-muted-foreground">{source.snippet}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : <ChatMarkdown text={message.answer?.text ?? ""} onJump={(seconds) => seekTo(seconds)} />}
              {message.answer?.bullets?.length ? (
                <ul className="space-y-1.5">
                  {message.answer.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" aria-hidden />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {message.answer?.citations.length ? (
                <div className="space-y-2 border-t border-border pt-2.5">
                  <p className="label-mono text-[8px]">引用证据</p>
                  {message.answer.citations.map((citation) => {
                    const segment = lecture.segments.find((item) => item.id === citation.segmentId);
                    const slide = citation.slideId
                      ? lecture.slides.find((item) => item.id === citation.slideId)
                      : undefined;
                    return (
                      <div
                        key={`${citation.segmentId}-${citation.time}`}
                        className="flex gap-2.5 rounded-lg border border-border/60 bg-background/40 p-2.5"
                      >
                        {slide ? (
                          <button
                            type="button"
                            onClick={() => jumpToSlide(slide.id)}
                            aria-label={`播放到截图证据:${slide.title}`}
                            className="w-24 shrink-0 overflow-hidden rounded border border-border transition-transform duration-200 ease-smooth hover:scale-[1.02]"
                          >
                            <img
                              src={slide.image}
                              alt={slide.title}
                              crossOrigin="anonymous"
                              loading="lazy"
                              className="w-full"
                            />
                          </button>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <TimestampChip
                              seconds={citation.time}
                              onJump={(seconds) =>
                                seekTo(seconds, { segmentId: citation.segmentId })
                              }
                            />
                            <span className="truncate text-[11px] text-muted-foreground">
                              {segment?.title}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            「{citation.quote}」
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ),
        )}
      </div>

      <div className="space-y-1.5">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(draft);
            }
          }}
          placeholder={chatBusy ? "正在检索…" : "问视频内容，或查找相关资料"}
          aria-label="输入问题"
          disabled={chatBusy}
          rows={2}
          className="resize-none"
        />
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-muted-foreground">
            Enter 发送,Shift + Enter 换行
          </p>
          <Button
            size="sm"
            className="ml-auto gap-1.5 rounded-full"
            onClick={() => submit(draft)}
            disabled={chatBusy || draft.trim().length === 0}
          >
            <Send className="h-3.5 w-3.5" aria-hidden />
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}

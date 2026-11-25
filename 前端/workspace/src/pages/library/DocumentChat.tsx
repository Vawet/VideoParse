import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, BookOpen, ChevronDown, GitBranch, MessageSquarePlus, Sparkles } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { API_BASE, openWorkspace, type LibraryDocument, type WebSource } from "@/lib/api";
import { Button } from "@/components/ui/button";

export type Passage = {docId: string; name: string; heading: string; ordinal: number; firstLine: number; lastLine: number; body: string};
type Claim = {id: number; answer: string; quote: string; firstLine: number; lastLine: number};
type Answer = {source: "web" | "document"; answer: string; explanation: string; conversation_id: string;
  hits: Passage[]; claims: Claim[]; web_sources: WebSource[]};
type Step = {stage: string; message: string; elapsedMs: number};
type ChatEvent = {type: "step"; data: Step} | {type: "answer"; data: Answer} | {type: "error"; data: string};
type Turn = {question: string; steps: Step[]; answer?: Answer; error?: string};

async function streamChat(body: object, signal: AbortSignal, receive: (event: ChatEvent) => void) {
  await openWorkspace();
  const response = await fetch(API_BASE + "/v2/documents/chat", {method: "POST", signal,
    headers: {"Content-Type":"application/json", Accept:"application/x-ndjson, application/json"}, body: JSON.stringify(body)});
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || "资料问答请求失败");
  }
  if (!response.body) throw new Error("没有收到回答，请重试。");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) throw new Error("连接中断，回答未完成。");
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0,end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const event: ChatEvent = JSON.parse(line);
        if (event.type === "error") throw new Error(event.data);
        receive(event);
        if (event.type === "answer") return;
      }
    }
  } finally { reader.releaseLock(); }
}

const prose = "prose prose-sm max-w-none break-words text-foreground dark:prose-invert prose-p:my-2 prose-li:my-0.5 prose-pre:overflow-x-auto";
function Reply({answer, openSource, save, saved}: {
  answer: Answer; openSource: (doc: string, first: number, last: number) => void;
  save: (hit: Passage) => void; saved: Set<string>;
}) {
  return <div className="space-y-3">
    {answer.answer && <div className="whitespace-pre-wrap break-words text-sm leading-7">{answer.answer}</div>}
    {answer.explanation && <div>
      <p className="mb-1 text-xs text-muted-foreground">模型讲解</p>
      <div className={prose}><Markdown remarkPlugins={[remarkGfm]} components={{img: () => null}}>{answer.explanation}</Markdown></div>
    </div>}
    {answer.claims.map((claim, i) => {
      const hit = answer.hits[claim.id - 1];
      return hit && <button key={i} onClick={() => openSource(hit.docId,claim.firstLine,claim.lastLine)}
        className="block w-full border-l-2 border-primary/50 pl-3 text-left text-sm hover:bg-accent">
        <span className="block whitespace-pre-wrap break-words">{claim.quote}</span>
        <span className="text-xs text-muted-foreground">[{claim.id}] {hit.name} · 第 {claim.firstLine}–{claim.lastLine} 行</span>
      </button>;
    })}
    {answer.web_sources.map((source, i) => <a key={source.url} className="block text-sm text-primary underline"
      href={source.url} target="_blank" rel="noopener noreferrer">[{i+1}] {source.title}
      <span className="mt-1 block text-xs text-muted-foreground">{source.snippet}</span></a>)}
    {answer.hits.length > 0 && <details className="rounded-lg border border-border px-3 py-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">相关原文 · {answer.hits.length} 个段落</summary>
      <div className="mt-2 divide-y divide-border">{answer.hits.map(hit => <div key={hit.docId + "/" + hit.ordinal} className="py-2">
        <button onClick={() => openSource(hit.docId,hit.firstLine,hit.lastLine)} className="block w-full text-left text-sm hover:text-primary">
          {hit.name} · 第 {hit.firstLine}–{hit.lastLine} 行
          {hit.heading && <span className="block text-xs text-muted-foreground">{hit.heading}</span>}
          <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{hit.body}</span>
        </button>
        <button className="mt-2 text-xs text-primary underline" onClick={() => save(hit)}>
          {saved.has(hit.docId + "/" + hit.ordinal) ? "已加入复习" : "加入复习"}
        </button>
      </div>)}</div>
    </details>}
  </div>;
}

export function DocumentChat({selected, docs, saved, openSource, onSave}: {
  selected: string; docs: LibraryDocument[]; saved: Set<string>;
  openSource: (doc: string, first: number, last: number) => void;
  onSave: (hit: Passage, question: string) => void;
}) {
  const [scope, setScope] = useState(selected);
  const [strict, setStrict] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const conversation = useRef<string | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns]);

  function reset() {conversation.current = undefined; setTurns([]);}
  async function send(event: FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    follow.current = true;
    setBusy(true); setDraft("");
    setTurns(old => [...old, {question, steps: []}]);
    function updateLast(change: (turn: Turn) => Turn) {
      setTurns(old => [...old.slice(0,-1), change(old[old.length-1])]);
    }
    try {
      await streamChat({question, documentId:scope || null, documentsOnly:strict, conversationId:conversation.current},
        controller.signal, message => {
          if (message.type === "step") updateLast(t => ({...t, steps:[...t.steps,message.data]}));
          if (message.type === "answer") {
            conversation.current = message.data.conversation_id;
            updateLast(t => ({...t,answer:message.data}));
          }
        });
    } catch (e) {
      if (!controller.signal.aborted) {
        updateLast(t => ({...t,error:(e as Error).message}));
        setDraft(question);
      }
    } finally {request.current = null; setBusy(false);}
  }

  return <section aria-label="资料 AI 对话" className="overflow-hidden rounded-xl border border-border bg-card">
    <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
      <h2 className="flex items-center gap-2 font-semibold"><Sparkles size={17} className="text-primary"/>资料 AI 对话</h2>
      <Button variant="ghost" size="sm" disabled={busy || !turns.length} onClick={reset}><MessageSquarePlus size={15}/>新对话</Button>
    </header>
    <div ref={log} role="log" aria-label="聊天记录" className="vp-scroll max-h-[58dvh] space-y-5 overflow-y-auto px-4 py-5 sm:px-5"
      onScroll={e => {const el=e.currentTarget; follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<50;}}>
      {!turns.length && <p className="flex items-center gap-2 text-sm text-muted-foreground"><BookOpen size={16}/>想弄懂笔记里的哪个问题？</p>}
      {turns.map((turn,i) => <article className="space-y-3" key={i}>
        <p aria-label="我的问题" className="ml-auto w-fit max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 text-sm">{turn.question}</p>
        <div className="space-y-2">
          {!!turn.steps.length && <details open={!turn.answer && !turn.error} className="group text-xs text-muted-foreground">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 hover:text-foreground">
              <GitBranch size={13}/>执行链路<ChevronDown size={12} className="transition-transform group-open:rotate-180"/>
            </summary>
            <ol className="my-2 ml-1.5 space-y-1.5 border-l border-border pl-3">{turn.steps.map((step,j) =>
              <li key={j} className="flex items-baseline gap-2"><span className="font-mono tabular-nums">{(step.elapsedMs/1000).toFixed(1)}s</span>{step.message}</li>)}</ol>
          </details>}
          {turn.answer ? <Reply answer={turn.answer} openSource={openSource} save={hit => onSave(hit,turn.question)} saved={saved}/> :
            turn.error ? <p role="alert" className="text-sm text-destructive">{turn.error}</p> :
            <p role="status" className="text-sm text-muted-foreground">正在回答…</p>}
        </div>
      </article>)}
    </div>
    <form onSubmit={send} className="space-y-3 border-t border-border p-4 sm:px-5">
      <textarea aria-label="资料问题" rows={2} maxLength={1000} value={draft} onChange={e => setDraft(e.target.value)}
        readOnly={busy} placeholder="输入问题，或继续追问…" className="block w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus-visible:outline-primary"
        onKeyDown={e => {if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {e.preventDefault(); e.currentTarget.form?.requestSubmit();}}}/>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select aria-label="检索范围" className="max-w-[55%] rounded-md border border-border bg-background p-1.5" value={scope} disabled={busy}
          onChange={e => {setScope(e.target.value); reset();}}>
          <option value="">全部文档</option>{docs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-muted-foreground" title="只根据文档回答，关闭网页搜索和模型补充讲解">
          <input type="checkbox" checked={strict} disabled={busy} onChange={e => {setStrict(e.target.checked); reset();}}/>仅用文档
        </label>
        <Button size="sm" aria-label="发送问题" disabled={busy || !draft.trim()} className="ml-auto rounded-full"><ArrowUp size={15}/>发送</Button>
      </div>
    </form>
  </section>;
}

import { ScopePicker } from "./ScopePicker";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, BookmarkPlus, Check, ChevronDown, PanelRightOpen, FileText, Files, Film, GitBranch, Layers2, List, MessageSquarePlus, Play, Waypoints } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { API_BASE, openWorkspace, type LibraryDocument, type LibraryVideo, type WebSource } from "@/lib/api";
import { Button } from "@/components/ui/button";

import { passageKey, sourceLabel, type Passage, type Source } from "./source";
type Claim = {id: number; answer: string; quote: string; firstLine: number; lastLine: number};
type Answer = {source: "web" | "document" | "library"; answer: string; explanation: string; conversation_id: string;
  hits: Passage[]; claims: Claim[]; web_sources: WebSource[]};
type Step = {stage: string; message: string; elapsedMs: number};
type ChatEvent = {type: "step"; data: Step} | {type: "answer"; data: Answer} | {type: "error"; data: string};
type Turn = {question: string; steps: Step[]; answer?: Answer; error?: string};

async function streamChat(body: object, signal: AbortSignal, receive: (event: ChatEvent) => void) {
  await openWorkspace();
  const response = await fetch(API_BASE + "/v2/library/chat", {method: "POST", signal,
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
  answer: Answer; openSource: (source: Source) => void;
  save: (hit: Passage, quote?: string) => void; saved: Set<string>;
}) {
  return <div className="space-y-3">
    {answer.answer && <div className="whitespace-pre-wrap break-words text-sm leading-7">{answer.answer}</div>}
    {answer.explanation && <div>
      <p className="mb-1 text-xs text-muted-foreground">模型讲解</p>
      <div className={prose}><Markdown remarkPlugins={[remarkGfm]} components={{img: () => null}}>{answer.explanation}</Markdown></div>
    </div>}
    {answer.claims.map((claim, i) => {
      const hit = answer.hits[claim.id - 1];
      const source = {...hit, firstLine: claim.firstLine, lastLine: claim.lastLine};
      return hit && <div key={i} className="library-citation"><button onClick={() => openSource(source)}
        className="library-citation-link">
        <span className="block whitespace-pre-wrap break-words">{claim.quote}</span>
        <span className="library-citation-source">{hit.videoId ? <Film size={14}/> : <FileText size={14}/>}
          <span>[{claim.id}] {sourceLabel(source)}</span><PanelRightOpen size={13}/>
        </span>
      </button><button className="library-citation-save" disabled={saved.has(passageKey(hit))}
        onClick={() => save(hit, claim.quote)}>{saved.has(passageKey(hit)) ? <><Check size={13}/>已加入复习</> : <><BookmarkPlus size={13}/>加入复习</>}</button></div>;
    })}
    {answer.web_sources.map((source, i) => <a key={source.url} className="block text-sm text-primary underline"
      href={source.url} target="_blank" rel="noopener noreferrer">[{i+1}] {source.title}
      <span className="mt-1 block text-xs text-muted-foreground">{source.snippet}</span></a>)}
    {answer.hits.length > 0 && <details className="rounded-lg border border-border px-3 py-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">相关原文 · {answer.hits.length} 个段落</summary>
      <div className="mt-2 divide-y divide-border">{answer.hits.map(hit => <div key={passageKey(hit)} className="py-2">
        <button onClick={() => openSource(hit)} className="block w-full text-left text-sm hover:text-primary">
          {sourceLabel(hit)}
          {hit.heading && <span className="block text-xs text-muted-foreground">{hit.heading}</span>}
          <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{hit.body}</span>
        </button>
        <button className="mt-2 text-xs text-primary underline" disabled={saved.has(passageKey(hit))} onClick={() => save(hit)}>
          {saved.has(passageKey(hit)) ? "已加入复习" : "加入复习"}
        </button>
      </div>)}</div>
    </details>}
  </div>;
}

const starters = [
  {label: "总结重点", icon: List, question: "总结所选资料中的关键概念，并标出出处。"},
  {label: "梳理关联", icon: Waypoints, question: "这些资料中的关键概念有哪些关联？请结合原文说明。"},
  {label: "出复习题", icon: Layers2, question: "根据所选资料出三道复习题，并给出可以回看的出处。"},
];

export function DocumentChat({selected, docs, videos, saved, libraryReady, openSource, onSave}: {
  selected: string; docs: LibraryDocument[]; videos: LibraryVideo[]; libraryReady: boolean; saved: Set<string>;
  openSource: (source: Source) => void;
  onSave: (hit: Passage, question: string, quote?: string) => void;
}) {
  const composer = useRef<HTMLTextAreaElement>(null);
  const [scope, setScope] = useState(selected ? "document/" + selected : "all");
  const [strict, setStrict] = useState(true);
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
      const [kind, sourceId] = scope.split("/");
      await streamChat({question, kind, sourceId, libraryOnly:strict, conversationId:conversation.current},
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

  const empty = !turns.length;
  const scopeCount = scope === "all" ? `${videos.length} 个视频、${docs.length} 篇文档`
    : scope === "video" ? `${videos.length} 个视频` : scope === "document" ? `${docs.length} 篇文档` : "";
  const welcome = scope.startsWith("document/") ? "想弄懂这篇文档里的什么？"
    : scope.startsWith("video/") ? "想弄懂这个视频里的什么？" : "想从这些资料里弄懂什么？";
  return <section aria-label="资料 AI 对话" className="library-dialogue" data-empty={empty}>
    {!empty && <header className="library-conversation-header">
      <h2 className="truncate text-sm font-medium" title={turns[0].question}>{turns[0].question}</h2>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => {reset(); composer.current?.focus();}}><MessageSquarePlus size={15}/>新对话</Button>
    </header>}
    <div ref={log} hidden={empty} role="log" aria-label="聊天记录" className="library-thread vp-scroll"
      onScroll={e => {const el=e.currentTarget; follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<50;}}>
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
          {turn.answer ? <Reply answer={turn.answer} openSource={openSource} save={(hit,quote) => onSave(hit,turn.question,quote)} saved={saved}/> :
            turn.error ? <p role="alert" className="text-sm text-destructive">{turn.error}</p> :
            <p role="status" className="text-sm text-muted-foreground">正在回答…</p>}
        </div>
      </article>)}
    </div>
    <div className="library-question-area">
      {empty && <div className="library-intro">
        <div className="library-material-mark" aria-hidden="true">
          <span className="mark-video"><Play size={16} fill="currentColor"/></span>
          <span className="mark-note"><i/><i/><i/></span>
        </div>
        <h1>{welcome}</h1>
        {libraryReady && !videos.length && !docs.length && <p>从「添加资料」放入第一个视频或文档，就可以开始提问。</p>}
      </div>}
      <form onSubmit={send} className="library-question-box">
        <textarea ref={composer} aria-label="资料问题" rows={2} maxLength={1000} value={draft} onChange={e => setDraft(e.target.value)}
          readOnly={busy} placeholder={!empty ? "继续追问…" : scope === "all" ? "输入问题，从视频和文档中查找答案…" : "输入关于所选资料的问题…"}
          onKeyDown={e => {if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {e.preventDefault(); e.currentTarget.form?.requestSubmit();}}}/>
        <div className="library-question-tools">
          <ScopePicker detail={libraryReady ? scopeCount : ""} value={scope} disabled={busy} onChange={next => {setScope(next); reset();}}
            groups={[
              {label: "资料范围", icon: Files, items: [{value: "all", name: "全部资料"}, {value: "video", name: "只看视频"}, {value: "document", name: "只看文档"}]},
              {label: "视频", icon: Film, items: videos.map(v => ({value: "video/" + v.id, name: v.name}))},
              {label: "文档", icon: FileText, items: docs.map(d => ({value: "document/" + d.id, name: d.name}))},
            ]}/>
          <label className="library-strict" title="只根据所选资料回答，关闭网页搜索和模型补充讲解">
            <input type="checkbox" checked={strict} disabled={busy} onChange={e => {setStrict(e.target.checked); reset();}}/>仅用资料库
          </label>
          <Button size="icon" aria-label="发送问题" title="发送问题" disabled={busy || !draft.trim()} className="library-send"><ArrowUp size={19}/></Button>
        </div>
      </form>
      {empty && <div className="library-starters" aria-label="建议问题">{starters.map(({label, icon: Icon, question}) =>
        <button type="button" key={label} onClick={() => {setDraft(question); composer.current?.focus();}}><Icon size={14}/>{label}</button>)}</div>}
    </div>
  </section>;
}

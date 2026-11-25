import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { LibraryDocument as Document, WebSource } from "@/lib/api";
import { api } from "./api";
import { indexPending, useLibrary } from "./use-library";
import { ThemeToggle } from "../workspace/components/ThemeToggle";
import { ReviewQueue } from "./ReviewQueue";

type Passage = { docId: string; name: string; heading: string; ordinal: number; firstLine: number; lastLine: number; body: string };
type Claim = { id: number; answer: string; quote: string; firstLine: number; lastLine: number };
type Answer = { source: "web"; answer: string; web_sources: WebSource[] } |
  { source: "document"; answer: string; generated: boolean; used_vectors: boolean; hits: Passage[]; claims?: Claim[] };
type Reading = { doc: Document; lines: string[]; from: number; to: number; page: number; locate: boolean };
const PAGE_LINES = 160;
export default function Library() {
  const [params] = useSearchParams();
  const selected = params.get("doc") || "";
  return <LibraryPage key={selected} selected={selected}/>;
}

function LibraryPage({selected}: {selected: string}) {
  const library = useLibrary();
  const docs = library.data?.documents ?? [];
  const current = docs.find(d => d.id === selected);
  const [scope, setScope] = useState(selected);
  const [documentsOnly, setDocumentsOnly] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [askedQuestion, setAskedQuestion] = useState("");
  const [reviewUpdated, setReviewUpdated] = useState(0);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const resultLine = useRef<HTMLSpanElement>(null);
  const readId = useRef(0);
  useEffect(() => {
    if (reading?.locate) resultLine.current?.scrollIntoView({ block: "nearest" });
  }, [reading]);

  const read = useCallback(async (id: string, from = 1, to = 1, locate = true) => {
    const generation = ++readId.current;
    try {
      const data = await api<{document: Document; markdown: string}>("/" + encodeURIComponent(id));
      if (generation === readId.current) setReading({doc: data.document, lines: data.markdown.split("\n"),
        from, to, locate, page: Math.floor((from - 1) / PAGE_LINES)});
    } catch (e) { if (generation === readId.current) setError((e as Error).message); }
  }, []);
  useEffect(() => {
    if (selected) void read(selected, 1, 1, false);
    return () => { readId.current++; };
  }, [selected, read]);

  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading(true); setError("");
    try {
      for (const file of files) {
        const form = new FormData(); form.set("file", file);
        await api("", {method:"POST", body:form});
      }
    } catch (e) { setError((e as Error).message); }
    finally {
      if (picker.current) picker.current.value = "";
      await library.refetch();
      setUploading(false);
    }
  }

  async function ask() {
    if (searching || !question.trim()) return;
    setError(""); setSearching(true); setAnswer(null); setAskedQuestion(question.trim());
    try {
      setAnswer(await api<Answer>("/ask", { method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({question:question.trim(), documentId:scope || null, documentsOnly}) }));
    } catch (e) { setError((e as Error).message); }
    finally { setSearching(false); }
  }

  async function saveForReview(hit: Passage) {
    const key = hit.docId + "/" + hit.ordinal;
    try {
      await api(`/${hit.docId}/chunks/${hit.ordinal}/review`, {method: "POST",
        headers: {"Content-Type": "application/json"}, body: JSON.stringify({question: askedQuestion})});
      setSaved(previous => new Set(previous).add(key));
      setReviewUpdated(previous => previous + 1);
    } catch (e) { setError((e as Error).message); }
  }

  return <main className="flex h-full min-w-0 flex-col bg-background text-foreground">
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border pl-14 pr-3 sm:pr-6">
      <span className="truncate text-sm font-medium">{selected ? "文档阅读" : "资料问答与复习"}</span>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" disabled={uploading} onClick={() => picker.current?.click()}><Upload size={15}/>{uploading ? "正在上传…" : "上传 Markdown"}</Button>
        <ThemeToggle/>
      </div>
      <input className="hidden" type="file" ref={picker} multiple accept=".md,.markdown" title="UTF-8 Markdown，每份上限 512 KiB" aria-label="选择 Markdown 文件"
        onChange={e => void upload(Array.from(e.target.files || []))}/>
    </header>
    <div className="vp-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[850px] px-5 py-7 sm:px-9 sm:py-10">
        <h1 className="break-words text-[28px] font-semibold tracking-tight sm:text-[34px]">{current?.name ?? (selected ? "文档阅读" : "资料问答与复习")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{current
          ? current.indexState === "ready" ? `已索引 · ${current.chunks} 个段落` : indexPending(current.indexState)
            ? `正在建立索引 · ${current.indexedChunks}/${current.chunks}` : "向量索引失败，可使用全文检索"
          : "从笔记中查找依据，把值得记住的段落加入复习。"}</p>
        {current?.indexState === "error" && <button className="text-xs text-primary underline" onClick={() => api("/"+current.id+"/retry",{method:"POST"}).then(()=>library.refetch()).catch(e=>setError(e.message))}>重试索引</button>}
        {!selected && !docs.length && library.isSuccess && <p className="mt-2 text-xs text-muted-foreground">支持 UTF-8 Markdown，每份上限 512 KiB。</p>}
        {library.isError && <button type="button" className="mt-3 text-sm text-primary underline" onClick={() => void library.refetch()}>资料库读取失败，重试</button>}
        {error && <p role="alert" className="mt-4 rounded border border-destructive/40 p-3 text-sm">{error}</p>}
        <div className="mt-6 flex flex-col gap-5">
          <section className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">资料问答</h2>
            <form className="space-y-3" onSubmit={e => {e.preventDefault(); void ask();}}>
              <label className="flex items-center gap-2 text-sm">检索范围
                <select className="max-w-[75%] rounded border bg-background p-1" value={scope} disabled={searching}
                  onChange={e => {setScope(e.target.value); setAnswer(null);}}>
                  <option value="">全部文档</option>{docs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={documentsOnly} disabled={searching}
                  onChange={e => {setDocumentsOnly(e.target.checked); setAnswer(null);}}/>
                仅用我的文档回答，关闭网页搜索
              </label>
              <textarea aria-label="资料问题" maxLength={1000} rows={3} required value={question} onChange={e=>setQuestion(e.target.value)}
                className="w-full rounded-md border border-border bg-background p-3 text-sm" placeholder="问笔记中的概念，或查找相关的官方文档"/>
              <Button disabled={searching || !question.trim()}>{searching ? "检索中…" : "提问"}</Button>
            </form>
            {answer && <article className="space-y-3 border-t border-border pt-4" aria-live="polite">
              <h3 className="text-sm font-semibold">{answer.source === "web" ? "联网资料" : answer.generated ? "依据原文生成" : "原文检索结果"}</h3>
              {answer.source === "document" && answer.claims?.length ? answer.claims.map((claim, index) => {
                const hit = answer.hits[claim.id - 1];
                return <div key={index} className="space-y-1.5">
                  <p className="whitespace-pre-wrap text-sm">{claim.answer} [{claim.id}]</p>
                  <button type="button" onClick={() => void read(hit.docId, claim.firstLine, claim.lastLine)}
                    className="block w-full border-l-2 border-gold/60 py-1 pl-3 text-left hover:bg-accent">
                    <span className="block whitespace-pre-wrap break-words text-sm">{claim.quote}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{hit.name} · 第 {claim.firstLine}–{claim.lastLine} 行</span>
                  </button>
                </div>;
              }) : <p className="whitespace-pre-wrap text-sm">{answer.answer}</p>}
              {answer.source === "web" ? answer.web_sources.map((s,i) => <a key={s.url} className="block text-sm text-primary underline" href={s.url} target="_blank" rel="noopener noreferrer">[{i+1}] {s.title}</a>) :
                answer.hits.map((h,i) => <div key={h.docId+"/"+h.ordinal}>
                  <button onClick={()=>void read(h.docId,h.firstLine,h.lastLine)}
                  className="block w-full rounded-md border border-border p-3 text-left hover:bg-accent">
                  <span className="text-sm font-medium">[{i+1}] {h.name} · 第 {h.firstLine}–{h.lastLine} 行</span>
                  {h.heading && <span className="block text-xs text-muted-foreground">{h.heading}</span>}
                  <span className="mt-1 block line-clamp-2 text-xs">{h.body}</span>
                  </button>
                  <button type="button" className="mt-1 text-xs text-primary underline" onClick={()=>void saveForReview(h)}>
                    {saved.has(h.docId+"/"+h.ordinal) ? "已加入复习" : "加入复习"}
                  </button>
                </div>)}
            </article>}
          </section>
          <ReviewQueue documentId={selected} updated={reviewUpdated} openSource={read} onRemove={()=>setSaved(new Set())}/>
          {reading && <section className={`rounded-xl border border-border bg-card p-5 ${selected ? "order-first" : ""}`}>
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><FileText size={16}/>{selected === reading.doc.id ? "原文" : reading.doc.name+" · 原文"}</h2>
            {reading.lines.length > PAGE_LINES && <nav aria-label="原文分页" className="mb-3 flex items-center gap-3 text-sm">
              <Button variant="outline" size="sm" disabled={reading.page === 0}
                onClick={()=>setReading({...reading, page: reading.page - 1})}>上一页</Button>
              <span>{reading.page + 1} / {Math.ceil(reading.lines.length / PAGE_LINES)}</span>
              <Button variant="outline" size="sm" disabled={(reading.page + 1) * PAGE_LINES >= reading.lines.length}
                onClick={()=>setReading({...reading, page: reading.page + 1})}>下一页</Button>
            </nav>}
            <pre key={reading.doc.id + "/" + reading.page} className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words text-sm">{reading.lines.slice(reading.page * PAGE_LINES,(reading.page + 1) * PAGE_LINES).map((line,offset)=>{
              const i=reading.page * PAGE_LINES + offset;
              return (
              <span key={i} ref={i+1===reading.from ? resultLine : undefined} className={`block ${reading.locate && i+1>=reading.from && i+1<=reading.to ? "bg-primary/15" : ""}`}>
                <span className="mr-3 select-none text-xs text-muted-foreground">{i+1}</span>{line}
              </span>);
            })}</pre>
          </section>}
        </div>
      </div>
    </div>
  </main>;
}

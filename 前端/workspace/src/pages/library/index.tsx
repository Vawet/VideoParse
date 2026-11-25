import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, FileText, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { API_BASE, openWorkspace, type WebSource } from "@/lib/api";

type Document = { id: string; name: string; chunks: number; indexedChunks: number; indexState: string };
type Passage = { docId: string; name: string; heading: string; ordinal: number; firstLine: number; lastLine: number; body: string };
type Answer = { source: "web"; answer: string; web_sources: WebSource[] } |
  { source: "document"; answer: string; generated: boolean; used_vectors: boolean; hits: Passage[] };
type Reading = { doc: Document; lines: string[]; from: number; to: number };
const pending = (doc: Document) => doc.indexState === "pending" || doc.indexState === "indexing";

async function api<T>(path = "", options?: RequestInit): Promise<T> {
  await openWorkspace();
  const res = await fetch(API_BASE + "/v2/documents" + path, options);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "请求未完成");
  return data;
}

export default function Library() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [scope, setScope] = useState("");
  const [reading, setReading] = useState<Reading | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const picker = useRef<HTMLInputElement>(null);
  const resultLine = useRef<HTMLSpanElement>(null);
  const readId = useRef(0);
  const needsRefresh = docs.some(pending);
  const refresh = useCallback(async () => {
    const data = await api<{ documents: Document[] }>();
    setDocs(data.documents);
  }, []);
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => {
    if (!needsRefresh) return;
    const id = window.setInterval(() => { refresh().catch(e => setError(e.message)); }, 3000);
    return () => window.clearInterval(id);
  }, [needsRefresh, refresh]);
  useEffect(() => {
    if (reading) resultLine.current?.scrollIntoView({ block: "nearest" });
  }, [reading]);

  async function read(id: string, from = 1, to = 1) {
    const generation = ++readId.current;
    try {
      const data = await api<{document: Document; markdown: string}>("/" + id);
      if (generation === readId.current) setReading({doc: data.document, lines: data.markdown.split("\n"), from, to});
    } catch (e) { setError((e as Error).message); }
  }

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
      await refresh().catch(e => setError(e.message));
      setUploading(false);
    }
  }

  async function ask() {
    if (searching || !question.trim()) return;
    setError(""); setSearching(true); setAnswer(null);
    try {
      setAnswer(await api<Answer>("/ask", { method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({question:question.trim(), documentId:scope || null}) }));
    } catch (e) { setError((e as Error).message); }
    finally { setSearching(false); }
  }

  return <main className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm"><ArrowLeft size={16}/>视频工作台</Link>
        <Button disabled={uploading} onClick={() => picker.current?.click()}><Upload size={16}/>{uploading ? "正在上传…" : "上传 Markdown"}</Button>
        <input className="hidden" type="file" ref={picker} multiple accept=".md,.markdown" aria-label="选择 Markdown 文件"
          onChange={e => void upload(Array.from(e.target.files || []))}/>
      </div>
    </header>
    <div className="mx-auto max-w-6xl p-5 md:p-8">
      <h1 className="mb-6 flex items-center gap-3 text-3xl font-semibold"><BookOpen className="text-primary"/>我的资料库</h1>
      {error && <p role="alert" className="mb-4 rounded border border-destructive/40 p-3 text-sm">{error}</p>}
      <div className="grid items-start gap-6 md:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 font-semibold">我的文档 <span className="text-sm text-muted-foreground">{docs.length}</span></h2>
          {!docs.length && <p className="text-sm text-muted-foreground">{loading ? "正在读取…" : "上传一份 UTF-8 Markdown 笔记，即可按原文提问。每份上限 512 KiB。"}</p>}
          <ul className="divide-y divide-border">{docs.map(d => <li key={d.id} className="py-3">
            <button className="flex items-center gap-2 text-left text-sm font-medium" onClick={() => void read(d.id)}><FileText size={16}/>{d.name}</button>
            <span className="mt-1 block text-xs text-muted-foreground">{d.indexState === "ready" ? `向量索引就绪 · ${d.chunks} 段` :
              pending(d) ? `正在建立向量索引 · ${d.indexedChunks}/${d.chunks}` : "向量索引失败，可用全文检索"}</span>
            {d.indexState === "error" && <button className="text-xs text-primary underline" onClick={() => api("/"+d.id+"/retry",{method:"POST"}).then(refresh).catch(e=>setError(e.message))}>重试索引</button>}
          </li>)}</ul>
        </section>
        <div className="space-y-5">
          <section className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">资料问答</h2>
            <form className="space-y-3" onSubmit={e => {e.preventDefault(); void ask();}}>
              <label className="flex items-center gap-2 text-sm">检索范围
                <select className="max-w-[75%] rounded border bg-background p-1" value={scope} disabled={searching}
                  onChange={e => {setScope(e.target.value); setAnswer(null);}}>
                  <option value="">全部文档</option>{docs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <textarea aria-label="资料问题" maxLength={1000} rows={3} required value={question} onChange={e=>setQuestion(e.target.value)}
                className="w-full rounded-md border border-border bg-background p-3 text-sm" placeholder="问笔记中的概念，或查找相关的官方文档"/>
              <Button disabled={searching || !question.trim()}>{searching ? "检索中…" : "提问"}</Button>
            </form>
            {answer && <article className="space-y-3 border-t border-border pt-4" aria-live="polite">
              <h3 className="text-sm font-semibold">{answer.source === "web" ? "联网资料" : answer.generated ? "依据原文生成" : "原文检索结果"}</h3>
              <p className="whitespace-pre-wrap text-sm">{answer.answer}</p>
              {answer.source === "web" ? answer.web_sources.map((s,i) => <a key={s.url} className="block text-sm text-primary underline" href={s.url} target="_blank" rel="noopener noreferrer">[{i+1}] {s.title}</a>) :
                answer.hits.map((h,i) => <button key={h.docId+"/"+h.ordinal} onClick={()=>void read(h.docId,h.firstLine,h.lastLine)}
                  className="block w-full rounded-md border border-border p-3 text-left hover:bg-accent">
                  <span className="text-sm font-medium">[{i+1}] {h.name} · 第 {h.firstLine}–{h.lastLine} 行</span>
                  {h.heading && <span className="block text-xs text-muted-foreground">{h.heading}</span>}
                  <span className="mt-1 block line-clamp-2 text-xs">{h.body}</span>
                </button>)}
            </article>}
          </section>
          {reading && <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 font-semibold">{reading.doc.name} · 原文</h2>
            <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words text-sm">{reading.lines.map((line,i)=>
              <span key={i} ref={i+1===reading.from ? resultLine : undefined} className={`block ${i+1>=reading.from && i+1<=reading.to ? "bg-primary/15" : ""}`}>
                <span className="mr-3 select-none text-xs text-muted-foreground">{i+1}</span>{line}
              </span>)}</pre>
          </section>}
        </div>
      </div>
    </div>
  </main>;
}

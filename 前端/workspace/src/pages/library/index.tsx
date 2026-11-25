import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, FileText, Film, Folder, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { fetchLibrary, type LibraryDocument as Document, type LibraryFolder, type LibraryVideo, type WebSource } from "@/lib/api";
import { api } from "./api";
import { LegacyImport } from "./LegacyImport";
import { ReviewQueue } from "./ReviewQueue";

type Passage = { docId: string; name: string; heading: string; ordinal: number; firstLine: number; lastLine: number; body: string };
type Answer = { source: "web"; answer: string; web_sources: WebSource[] } |
  { source: "document"; answer: string; generated: boolean; used_vectors: boolean; hits: Passage[] };
type Reading = { doc: Document; lines: string[]; from: number; to: number; page: number };
const PAGE_LINES = 160;
const pending = (doc: Document) => doc.indexState === "pending" || doc.indexState === "indexing";

export default function Library() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const refreshId = useRef(0);
  const [scope, setScope] = useState("");
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
  const [loading, setLoading] = useState(true);
  const picker = useRef<HTMLInputElement>(null);
  const resultLine = useRef<HTMLSpanElement>(null);
  const readId = useRef(0);
  const needsRefresh = docs.some(pending);
  const refresh = useCallback(async () => {
    const generation = ++refreshId.current;
    const data = await fetchLibrary();
    if (generation !== refreshId.current) return;
    setDocs(data.documents);
    setFolders(data.folders);
    setVideos(data.videos);
  }, []);
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => {
    const reload = () => { if (document.visibilityState === "visible") refresh().catch(e => setError(e.message)); };
    document.addEventListener("visibilitychange", reload);
    return () => document.removeEventListener("visibilitychange", reload);
  }, [refresh]);
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
      if (generation === readId.current) setReading({doc: data.document, lines: data.markdown.split("\n"),
        from, to, page: Math.floor((from - 1) / PAGE_LINES)});
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
          <h2 className="mb-3 font-semibold">我的文件夹</h2>
          {loading && <p className="text-sm text-muted-foreground">正在读取…</p>}
          {folders.map(folder => <details key={folder.id} open className="border-t border-border py-3">
            <summary className="cursor-pointer font-medium">
              <span className="inline-flex items-center gap-2 align-middle"><Folder size={16}/>{folder.name}
                <span className="text-xs text-muted-foreground">{folder.id === "videos" ? videos.length : docs.length}</span>
              </span>
            </summary>
            {folder.id === "videos" ? <div className="mt-2">
              {!videos.length && <p className="text-sm text-muted-foreground">解析完成的视频会自动保存在这里。</p>}
              <ul className="divide-y divide-border">{videos.map(video => <li key={video.id} className="py-2">
                <Link to={"/library/videos/" + encodeURIComponent(video.id)} className="flex items-center gap-2 text-sm hover:underline">
                  <Film size={16}/>{video.name}
                </Link>
              </li>)}</ul>
              <LegacyImport/>
            </div> : <div className="mt-2">
              {!docs.length && <p className="text-sm text-muted-foreground">上传一份 UTF-8 Markdown 笔记，即可按原文提问。每份上限 512 KiB。</p>}
              <ul className="divide-y divide-border">{docs.map(d => <li key={d.id} className="py-3">
                <button className="flex items-center gap-2 text-left text-sm font-medium" onClick={() => void read(d.id)}><FileText size={16}/>{d.name}</button>
                <span className="mt-1 block text-xs text-muted-foreground">{d.indexState === "ready" ? `向量索引就绪 · ${d.chunks} 段` :
                  pending(d) ? `正在建立向量索引 · ${d.indexedChunks}/${d.chunks}` : "向量索引失败，可用全文检索"}</span>
                {d.indexState === "error" && <button className="text-xs text-primary underline" onClick={() => api("/"+d.id+"/retry",{method:"POST"}).then(refresh).catch(e=>setError(e.message))}>重试索引</button>}
              </li>)}</ul>
            </div>}
          </details>)}
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
              <p className="whitespace-pre-wrap text-sm">{answer.answer}</p>
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
          <ReviewQueue updated={reviewUpdated} openSource={read} onRemove={()=>setSaved(new Set())}/>
          {reading && <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 font-semibold">{reading.doc.name} · 原文</h2>
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
              <span key={i} ref={i+1===reading.from ? resultLine : undefined} className={`block ${i+1>=reading.from && i+1<=reading.to ? "bg-primary/15" : ""}`}>
                <span className="mr-3 select-none text-xs text-muted-foreground">{i+1}</span>{line}
              </span>);
            })}</pre>
          </section>}
        </div>
      </div>
    </div>
  </main>;
}

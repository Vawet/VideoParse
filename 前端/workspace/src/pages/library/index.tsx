import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Upload } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { LibraryDocument as Document } from "@/lib/api";
import { api, uploadDocument } from "./api";
import { indexPending, useLibrary } from "./use-library";
import { ThemeToggle } from "../workspace/components/ThemeToggle";
import { ReviewQueue } from "./ReviewQueue";
import { PasteMarkdown } from "./PasteMarkdown";

import { DocumentChat, type Passage } from "./DocumentChat";

type Reading = { doc: Document; lines: string[]; from: number; to: number; page: number; locate: boolean };
const PAGE_LINES = 160;

// The hash uses zero-based line boundaries; the reader and API use inclusive line numbers.
function lineFragment(first: number, last: number) {
  return `#line=${first - 1},${last}`;
}

function fragmentRange(hash: string) {
  const match = /^#line=(\d+),(\d+)$/.exec(hash);
  if (!match) return null;
  const first = Number(match[1]) + 1;
  const last = Number(match[2]);
  return Number.isSafeInteger(first) && Number.isSafeInteger(last) && first <= last ? {first, last} : null;
}

export default function Library() {
  const [params] = useSearchParams();
  const selected = params.get("doc") || "";
  const {state} = useLocation();
  return <LibraryPage key={selected + "/" + (state?.libraryChange ?? "")} selected={selected}/>;
}

function LibraryPage({selected}: {selected: string}) {
  const {hash, search} = useLocation();
  const navigate = useNavigate();
  const library = useLibrary();
  const docs = library.data?.documents ?? [];
  const current = docs.find(d => d.id === selected);
  const [reading, setReading] = useState<Reading | null>(null);
  const [reviewUpdated, setReviewUpdated] = useState(0);
  const [saved, setSaved] = useState<Set<string>>(new Set());
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
      if (generation !== readId.current) return;
      const lines = data.markdown.split("\n");
      const highlight = locate && from <= lines.length;
      setReading({doc: data.document, lines, from, to: Math.min(to, lines.length), locate: highlight,
        page: highlight ? Math.floor((from - 1) / PAGE_LINES) : 0});
    } catch (e) { if (generation === readId.current) setError((e as Error).message); }
  }, []);
  useEffect(() => {
    const range = fragmentRange(hash);
    if (selected) void read(selected, range?.first, range?.last, Boolean(range));
    return () => { readId.current++; };
  }, [selected, hash, read]);

  function openSource(id: string, first: number, last: number) {
    const fragment = lineFragment(first, last);
    if (id === selected && hash !== fragment) {
      void navigate({search, hash: fragment}, {preventScrollReset: true});
    } else {
      void read(id, first, last);
    }
  }

  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading(true); setError("");
    try {
      for (const file of files) await uploadDocument(file);
    } catch (e) { setError((e as Error).message); }
    finally {
      if (picker.current) picker.current.value = "";
      await library.refetch();
      setUploading(false);
    }
  }

  async function saveForReview(hit: Passage, question: string) {
    const key = hit.docId + "/" + hit.ordinal;
    try {
      await api(`/${hit.docId}/chunks/${hit.ordinal}/review`, {method: "POST",
        headers: {"Content-Type": "application/json"}, body: JSON.stringify({question})});
      setSaved(previous => new Set(previous).add(key));
      setReviewUpdated(previous => previous + 1);
    } catch (e) { setError((e as Error).message); }
  }

  return <main className="flex h-full min-w-0 flex-col bg-background text-foreground">
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border pl-14 pr-3 sm:pr-6">
      <span className="truncate text-sm font-medium">{selected ? "文档阅读" : "资料问答与复习"}</span>
      <div className="flex shrink-0 items-center gap-2">
        <PasteMarkdown disabled={uploading} onSaved={id => {
          void library.refetch();
          void navigate("/library?doc=" + encodeURIComponent(id));
        }}/>
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
          <div className="order-first"><DocumentChat selected={selected} docs={docs} saved={saved} openSource={openSource} onSave={saveForReview}/></div>
          <ReviewQueue documentId={selected} updated={reviewUpdated} openSource={openSource} onRemove={()=>setSaved(new Set())}/>
          {reading && <section className={`rounded-xl border border-border bg-card p-5 ${selected ? "order-first" : ""}`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex min-w-0 items-center gap-2 break-all font-semibold"><FileText size={16} className="shrink-0"/>{selected === reading.doc.id ? "原文" : reading.doc.name+" · 原文"}</h2>
              {reading.locate && <a className="inline-flex items-center gap-1.5 text-xs text-primary underline"
                href={`/library?doc=${encodeURIComponent(reading.doc.id)}${lineFragment(reading.from, reading.to)}`}
                target="_blank" rel="noopener noreferrer">新标签页打开引文<ExternalLink size={13} aria-hidden/></a>}
            </div>
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

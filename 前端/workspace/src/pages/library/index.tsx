import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ClipboardPaste, ExternalLink, FileText, Film, Plus, Upload, X } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { API_BASE, type LibraryDocument as Document } from "@/lib/api";
import { api, libraryApi, uploadDocument } from "./api";
import { indexPending, useLibrary } from "./use-library";
import { ThemeToggle } from "../workspace/components/ThemeToggle";
import { ReviewQueue } from "./ReviewQueue";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PasteMarkdown } from "./PasteMarkdown";

import { DocumentChat } from "./DocumentChat";
import { passageKey, sourceLabel, videoPassagePath, type Passage, type Source } from "./source";

import "./library.css";

type VideoReading = {hit: Passage; filepath: string};
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
  const {hash, search, state, key} = useLocation();
  const navigate = useNavigate();
  const library = useLibrary();
  const docs = library.data?.documents ?? [];
  const videos = library.data?.videos ?? [];
  const [videoReading, setVideoReading] = useState<VideoReading | null>(null);
  const [mediaError, setMediaError] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [readerOpen, setReaderOpen] = useState(Boolean(selected));
  const [pasteOpen, setPasteOpen] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const sourceTrigger = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const sourceDoc = reading?.doc ? docs.find(doc => doc.id === reading.doc.id) ?? reading.doc : undefined;
  const [reviewUpdated, setReviewUpdated] = useState(0);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const resultLine = useRef<HTMLSpanElement>(null);
  const readId = useRef(0);
  useEffect(() => {
    if (reading?.locate && resultLine.current) {
      resultLine.current.focus({preventScroll: true});
      resultLine.current.scrollIntoView({block: "nearest"});
    }
  }, [reading]);

  const read = useCallback(async (id: string, from = 1, to = 1, locate = true) => {
    const generation = ++readId.current;
    try {
      const data = await api<{document: Document; markdown: string}>("/" + encodeURIComponent(id));
      if (generation !== readId.current) return;
      const lines = data.markdown.split("\n");
      const highlight = locate && from <= lines.length;
      setVideoReading(null);
      setReading({doc: data.document, lines, from, to: Math.min(to, lines.length), locate: highlight,
        page: highlight ? Math.floor((from - 1) / PAGE_LINES) : 0});
    } catch (e) { if (generation === readId.current) setError((e as Error).message); }
  }, []);
  useEffect(() => {
    const range = fragmentRange(hash);
    if (selected) {
      setReaderOpen(true);
      setError("");
      void read(selected, range?.first, range?.last, Boolean(range));
    }
    return () => { readId.current++; };
  }, [selected, hash, key, read]);

  async function openSource(source: Source) {
    sourceTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReaderOpen(true);
    setError("");
    if (source.videoId) {
      const generation = ++readId.current;
      setReading(null);
      setVideoReading(null);
      try {
        const video = await libraryApi<VideoReading>(videoPassagePath(source));
        if (generation === readId.current) { setMediaError(false); setVideoReading(video); }
      } catch (e) { if (generation === readId.current) setError((e as Error).message); }
      return;
    }
    const {docId: id, firstLine: first, lastLine: last} = source;
    if (!id) return;
    setVideoReading(null);
    setReading(null);
    const fragment = lineFragment(first, last);
    if (id === selected && hash !== fragment) {
      void navigate({search, hash: fragment}, {state, preventScrollReset: true});
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

  async function saveForReview(hit: Passage, question: string, quote?: string) {
    const key = passageKey(hit);
    try {
      const options = {method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({question, quote})};
      if (hit.videoId) await libraryApi(videoPassagePath(hit) + "/review", options);
      else await api(`/${hit.docId}/chunks/${hit.ordinal}/review`, options);
      setSaved(previous => new Set(previous).add(key));
      setReviewUpdated(previous => previous + 1);
    } catch (e) { setError((e as Error).message); }
  }

  function closeReader() {
    readId.current++;
    setReaderOpen(false);
    setReading(null);
    setVideoReading(null);
    setError("");
    requestAnimationFrame(() => {
      const target = sourceTrigger.current;
      if (target?.isConnected && target.getClientRects().length) target.focus();
      else document.querySelector<HTMLTextAreaElement>('textarea[aria-label="资料问题"]')?.focus();
    });
  }

  useEffect(() => {
    if (readerOpen) closeButton.current?.focus({preventScroll: true});
  }, [readerOpen]);

  return <main className="library-workspace flex h-full min-w-0 flex-col bg-background text-foreground" data-reader={readerOpen}>
    <header className="app-toolbar flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border pl-14 pr-2 sm:pr-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="library-toolbar-title">资料库</span>
        {selected && !readerOpen && <button type="button" className="library-reopen" aria-label="查看原文" title="查看原文"
          onClick={e => {
            sourceTrigger.current = e.currentTarget;
            setReaderOpen(true);
            setError("");
            const range = fragmentRange(hash);
            void read(selected, range?.first, range?.last, Boolean(range));
          }}><FileText size={14}/><span>查看原文</span></button>}
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <ReviewQueue documentId={selected} updated={reviewUpdated} openSource={openSource} onRemove={() => setSaved(new Set())}/>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" ref={addButton} className="library-add" disabled={uploading}>
              <Plus size={15}/>{uploading ? "正在上传…" : "添加资料"}<ChevronDown size={13}/>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem asChild><Link to="/?add=video"><Film size={16}/>添加视频</Link></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => picker.current?.click()}><Upload size={16}/>上传 Markdown</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPasteOpen(true)}><ClipboardPaste size={16}/>粘贴文档</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PasteMarkdown open={pasteOpen} onOpenChange={setPasteOpen} returnFocus={addButton} onSaved={id => {
          void library.refetch();
          void navigate("/library?doc=" + encodeURIComponent(id));
        }}/>
        <ThemeToggle/>
      </div>
      <input hidden type="file" ref={picker} multiple accept=".md,.markdown" title="UTF-8 Markdown，每份上限 512 KiB" aria-label="选择 Markdown 文件"
        onChange={e => void upload(Array.from(e.target.files || []))}/>
    </header>
    {library.isError && <button type="button" className="shrink-0 border-b py-2 text-sm text-primary" onClick={() => void library.refetch()}>资料库读取失败，点击重试</button>}
    {error && <p role="alert" className="shrink-0 border-b border-destructive/40 px-4 py-2 text-sm">{error}</p>}
    <ResizablePanelGroup direction="horizontal" autoSaveId="library-chat-source" className="min-h-0 flex-1">
      <ResizablePanel id="library-chat" order={1} defaultSize={56} minSize={32} className="library-chat min-h-0 min-w-0">
        <DocumentChat selected={selected} docs={docs} videos={videos} libraryReady={library.isSuccess} saved={saved}
          openSource={openSource} onSave={saveForReview}/>
      </ResizablePanel>
      <ResizableHandle disabled={!readerOpen} aria-label="调整对话与出处的宽度" aria-orientation="vertical"
        title="拖动分隔线，或用左右方向键调整宽度" className="library-divider hover:bg-primary focus-visible:bg-primary"/>
      <ResizablePanel id="library-reader" order={2} defaultSize={44} minSize={32} tagName="section"
        aria-label="资料出处" className="library-reader min-h-0 min-w-0 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {videoReading ? <Film size={14}/> : <FileText size={14}/>}资料出处
            </span>
            <h2 className="mt-1.5 break-words text-lg font-semibold">{videoReading?.hit.name || sourceDoc?.name || "读取资料"}</h2>
            {sourceDoc && <p className="mt-1 text-xs text-muted-foreground">{sourceDoc.indexState === "ready" ? `已索引 · ${sourceDoc.chunks} 个段落` : indexPending(sourceDoc.indexState)
              ? `正在建立索引 · ${sourceDoc.indexedChunks}/${sourceDoc.chunks}` : "向量索引失败，可使用全文检索"}</p>}
            {sourceDoc?.indexState === "error" && <button className="text-xs text-primary underline" onClick={() => api("/"+sourceDoc.id+"/retry",{method:"POST"}).then(()=>library.refetch()).catch(e=>setError(e.message))}>重试索引</button>}
          </div>
          <Button ref={closeButton} variant="ghost" size="icon" aria-label="关闭出处，返回对话" title="关闭出处，返回对话" onClick={closeReader}><X size={17}/></Button>
        </header>
        <div className="min-h-0 flex-1">
          {videoReading ? <section aria-label="视频出处" className="vp-scroll h-full space-y-4 overflow-auto p-5">
            <p className="text-sm font-medium">{sourceLabel(videoReading.hit)}</p>
            {videoReading.filepath && videoReading.hit.start != null && !mediaError
              ? <video key={passageKey(videoReading.hit)} controls playsInline preload="metadata" className="w-full rounded-lg"
                  aria-label="回看引用片段" src={API_BASE + "/uploads/" + encodeURIComponent(videoReading.filepath)}
                  onLoadedMetadata={e => { e.currentTarget.currentTime = videoReading.hit.start ?? 0; }}
                  onError={() => setMediaError(true)}/>
              : videoReading.hit.start != null && <p className="text-sm text-muted-foreground">原片暂不可播放，可阅读下方引文。</p>}
            {videoReading.hit.frame && <img key={videoReading.hit.frame} alt="引用时刻的画面" className="max-h-72 max-w-full object-contain"
              src={API_BASE + "/frames/" + encodeURIComponent(videoReading.hit.videoId!) + "/" + encodeURIComponent(videoReading.hit.frame)}
              onError={e => { e.currentTarget.hidden = true; }}/>}
            <blockquote className="whitespace-pre-wrap border-l-2 border-primary/50 pl-3">{videoReading.hit.body}</blockquote>
          </section> : reading ? <section aria-label="文档原文" className="flex h-full min-h-0 flex-col">
            {(reading.locate || reading.lines.length > PAGE_LINES) && <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2 lg:px-7">
              {reading.locate && <a className="inline-flex items-center gap-1.5 text-xs text-primary underline"
                href={`/library?doc=${encodeURIComponent(reading.doc.id)}${lineFragment(reading.from, reading.to)}`}
                target="_blank" rel="noopener noreferrer">新标签页打开引文<ExternalLink size={13} aria-hidden/></a>}
              {reading.lines.length > PAGE_LINES && <nav aria-label="原文分页" className="ml-auto flex items-center gap-3 text-sm">
                <Button variant="outline" size="sm" disabled={reading.page === 0}
                  onClick={()=>setReading({...reading, page: reading.page - 1})}>上一页</Button>
                <span>{reading.page + 1} / {Math.ceil(reading.lines.length / PAGE_LINES)}</span>
                <Button variant="outline" size="sm" disabled={(reading.page + 1) * PAGE_LINES >= reading.lines.length}
                  onClick={()=>setReading({...reading, page: reading.page + 1})}>下一页</Button>
              </nav>}
            </div>}
            <pre key={reading.doc.id + "/" + reading.page} aria-label="原文行" tabIndex={0} className="vp-scroll min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-5 py-4 text-sm leading-7 lg:px-7">{reading.lines.slice(reading.page * PAGE_LINES,(reading.page + 1) * PAGE_LINES).map((line,offset)=>{
              const i=reading.page * PAGE_LINES + offset;
              return (
              <span key={i} tabIndex={i+1===reading.from && reading.locate ? -1 : undefined} ref={i+1===reading.from ? resultLine : undefined} className={`block ${reading.locate && i+1>=reading.from && i+1<=reading.to ? "bg-primary/15" : ""}`}>
                <span className="mr-3 select-none text-xs text-muted-foreground">{i+1}</span>{line}
              </span>);
            })}</pre>
          </section> : readerOpen && !error && <p role="status" className="p-5 text-sm text-muted-foreground">正在读取原文…</p>}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  </main>;
}

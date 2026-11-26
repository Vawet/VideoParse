import { GraduationCap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, Film, Folder, Layers2, MessageCircle, PanelLeft, Search, SquarePlay, Play, RotateCw, Plus, Ellipsis, Eye, Pencil, Trash2 } from "lucide-react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { API_BASE, getClientId } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { libraryApi } from "./api";
import { useLibrary } from "./use-library";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PasteMarkdown } from "./PasteMarkdown";
import { LibraryItemDialog, type LibraryAction } from "./LibraryItemDialog";
import { WorkspaceAccount } from "./WorkspaceAccount";
import Workspace from "../workspace";

const row = "nav-row flex min-h-9 min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium outline-offset-1 hover:bg-sidebar-accent focus-visible:outline-ring";
const selected = "nav-selected";
function VideoThumbnail({id}: {id: string}) {
  const tile = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!tile.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {setVisible(true); observer.disconnect();}
    });
    observer.observe(tile.current);
    return () => observer.disconnect();
  }, []);
  const {data: image} = useQuery({
    queryKey: ["library-thumbnail", getClientId(), id],
    enabled: visible, staleTime: 600_000, retry: false,
    queryFn: async ({signal}) => {
      const response = await fetch(API_BASE + "/frames/" + encodeURIComponent(id), {signal});
      if (!response.ok) throw new Error("无法读取视频封面");
      const frames: {ppt?: string[]; heavy?: string[]} = await response.json();
      return frames.ppt?.[0] ?? frames.heavy?.[0] ?? null;
    },
  });
  return <span className="library-tile library-tile-video" ref={tile} aria-hidden="true">
    {image && !failed ? <img alt="" src={API_BASE + image} onError={() => setFailed(true)}/> : <Play size={12} fill="currentColor"/>}
  </span>;
}

const indexStates: Record<string,string> = {
  ready: "可引用字幕或画面文字", derived: "仅有 AI 解析内容", pending: "正在建立索引", empty: "暂无可读取内容", error: "索引失败",
};

function LibraryList({onSelect}: {onSelect?: () => void}) {
  const {pathname, search, hash} = useLocation();
  const navigate = useNavigate();
  const [action, setAction] = useState<LibraryAction | null>(null);
  const [params] = useSearchParams();
  const {data, isPending, isError, refetch} = useLibrary();
  const detailed = pathname === "/library";
  const [retryError, setRetryError] = useState("");
  const [filter, setFilter] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const doc = params.get("doc");
  const term = filter.trim().toLocaleLowerCase();
  const match = (name: string) => name.toLocaleLowerCase().includes(term);
  const docPath = (id: string) => "/library?doc=" + encodeURIComponent(id);
  function finishAction() {
    if (!action) return;
    void refetch();
    const target = action.folder === "videos" ? "/library/videos/" + action.id : docPath(action.id);
    const isDocument = action.folder === "documents";
    if (action.kind === "delete" && (pathname === target || pathname === "/library")) {
      const removingCurrent = isDocument ? doc === action.id : pathname === target;
      void navigate(removingCurrent ? "/library" : pathname + search + hash, {
        replace: true, state: {libraryChange: Date.now()},
      });
    }
    setAction(null);
  }

  return <nav className="study-library-nav flex h-full min-w-0 flex-col text-sidebar-foreground" aria-label="资料库导航" data-library-detail={detailed}>
    <Link to="/" onClick={onSelect} className="sidebar-brand" aria-label="VideoParse 工作台"><span className="brand-mark" aria-hidden><i/><i/><i/></span>VideoParse</Link>
    <div className="nav-group-title">工作空间</div>
    <div className="space-y-1 px-3">
      <Link to="/" onClick={onSelect} aria-current={pathname === "/" ? "page" : undefined}
        className={cn(row, pathname === "/" && selected)}><SquarePlay size={17}/>视频工作台</Link>
      <Link to="/library" onClick={onSelect} aria-current={pathname === "/library" && !doc ? "page" : undefined}
        className={cn(row, pathname === "/library" && !doc && selected)}><MessageCircle size={17}/>资料问答与复习</Link>
      <Link to={doc?"/interview?doc="+encodeURIComponent(doc):"/interview"} onClick={onSelect} aria-current={pathname==="/interview"?"page":undefined}
        className={cn(row,pathname==="/interview" && selected)}><GraduationCap size={17}/>知识库面试</Link>
    </div>
    <div className="nav-group-title nav-library-label">{detailed ? "我的资料" : <><Layers2 size={13} aria-hidden/>资料库</>}</div>
    <label className="nav-search mx-3 mb-3 flex min-h-9 items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
      <Search size={15}/><input type="search" value={filter} onChange={e=>{setFilter(e.target.value); if (e.target.value) setClosed({});}} aria-label="搜索资料库"
        placeholder="搜索视频或文档" className="min-w-0 flex-1 bg-transparent py-1 text-xs text-foreground outline-none"/>
    </label>
    <div className="vp-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4">
      {retryError && <p role="alert" className="px-2 text-xs text-destructive">{retryError}</p>}
      {isPending && <p role="status" className="px-2 text-xs text-muted-foreground">正在读取资料库…</p>}
      {isError && <button className="px-2 text-xs text-primary underline" onClick={()=>void refetch()}>资料库读取失败，重试</button>}
      {data?.folders.map(folder => {
        const video = folder.id === "videos";
        const items = video ? data.videos : data.documents;
        const visible = items.filter(item => match(item.name));
        const open = !closed[folder.id];
        return <section key={folder.id} className="mb-2">
          <div className="flex items-center">
          <button type="button" aria-expanded={open} className={cn(row,"flex-1")}
            onClick={()=>setClosed({...closed,[folder.id]:open})}>
            <ChevronRight size={13} className={cn("text-muted-foreground transition-transform",open && "rotate-90")}/>
            {!detailed && <Folder size={17} className="text-primary"/>}{folder.name}
            <span className="nav-count">{items.length}</span>
          </button>
          {video
            ? <Link to="/?add=video" onClick={onSelect} aria-label="新增视频" title="新增视频"
                className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-primary"><Plus size={16}/></Link>
            : <PasteMarkdown sidebar onSaved={id => {setFilter(""); setClosed({...closed,documents:false}); void refetch(); onSelect?.(); void navigate(docPath(id));}}/>}
          </div>
          {open && <ul className="nav-children ml-4 border-l border-border pl-2">
            {visible.map(item => {
              const url = video ? "/library/videos/" + encodeURIComponent(item.id) : docPath(item.id);
              const active = video ? pathname === url : pathname === "/library" && doc === item.id;
              const Icon = video ? Film : FileText;
              const videoState = video ? indexStates[item.indexState ?? "pending"] : "";
              const meta = "duration" in item ? formatTime(item.duration) +
                (["error","empty","pending","derived"].includes(item.indexState ?? "pending") ? " · " + videoState : "")
                : item.chunks + " 个段落";
              return <li key={item.id} className={cn("flex items-center rounded-lg",active && selected)}>
                <Link to={url} onClick={onSelect} title={videoState ? item.name + " · " + videoState : item.name} aria-current={active ? "page" : undefined}
                  className={cn(row,"min-h-8 flex-1 font-normal")}>{detailed ? <>
                    {video ? <VideoThumbnail id={item.id}/> : <span className="library-tile library-tile-doc"><FileText size={16}/></span>}
                    <span className="min-w-0"><span className="block truncate">{item.name}</span><small className="block truncate" title={meta}>{meta}</small></span>
                  </> : <><Icon size={14} className="shrink-0"/><span className="truncate">{item.name}</span></>}</Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={item.name + " 的操作"} title="资料操作"
                      className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-primary"><Ellipsis size={15}/></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild><Link to={url} onClick={onSelect}><Eye size={15}/>查看</Link></DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setAction({folder:folder.id, ...item, kind:"rename"})}><Pencil size={15}/>重命名</DropdownMenuItem>
                    {video && (item.indexState === "error" || item.indexState === "empty") && <DropdownMenuItem onSelect={() => {
                      setRetryError("");
                      void libraryApi("/videos/" + encodeURIComponent(item.id) + "/retry", {method: "POST"})
                        .then(() => refetch()).catch(e => setRetryError(e.message));
                    }}><RotateCw size={15}/>重试索引</DropdownMenuItem>}
                    <DropdownMenuSeparator/>
                    <DropdownMenuItem className="text-destructive" onSelect={() => setAction({folder:folder.id, ...item, kind:"delete"})}>
                      <Trash2 size={15}/>{video ? "从资料库移除" : "删除文档"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>;
            })}
            {!visible.length && <li className="px-2.5 py-1.5 text-xs text-muted-foreground">{term ? "无匹配项" : "暂无" + folder.name}</li>}
          </ul>}
        </section>;
      })}
    </div>
    <WorkspaceAccount/>
    {action && <LibraryItemDialog action={action} onClose={() => setAction(null)} onSaved={finishAction}/>}
  </nav>;
}

export default function LibraryShell() {
  const {pathname} = useLocation();
  const home = pathname === "/";
  const [visitedHome, setVisitedHome] = useState(home);
  const [open, setOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const drawerContent = useRef<HTMLDivElement>(null);
  useEffect(() => { if (home) setVisitedHome(true); }, [home]);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 768px)");
    const change = () => { if (m.matches) setDrawer(false); };
    m.addEventListener("change", change);
    return () => m.removeEventListener("change", change);
  }, []);
  return <div className="study-shell flex h-full min-h-0 bg-background text-foreground">
    <aside id="desktop-library" data-open={open} inert={!open} className="desktop-library hidden shrink-0 md:block">
      <LibraryList/>
    </aside>
    <div className="relative min-w-0 flex-1">
      <button type="button" aria-label={open ? "收起资料库" : "展开资料库"} aria-expanded={open} aria-controls="desktop-library"
        className="library-toggle hidden md:grid" onClick={()=>setOpen(!open)}><PanelLeft size={19}/></button>
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetTrigger asChild><button type="button" aria-label="打开资料库列表" className="library-toggle grid md:hidden"><PanelLeft size={19}/></button></SheetTrigger>
        <SheetContent side="left" ref={drawerContent} aria-describedby={undefined}
          className="w-[min(82vw,300px)] bg-sidebar p-0 motion-reduce:animate-none"
          onOpenAutoFocus={event => {
            const nav = drawerContent.current;
            const link = nav?.querySelector<HTMLElement>("a[aria-current=page]") ?? nav?.querySelector("a");
            if (link) {
              event.preventDefault();
              link.focus();
            }
          }}>
          <SheetTitle className="sr-only">资料库</SheetTitle><LibraryList onSelect={()=>setDrawer(false)}/>
        </SheetContent>
      </Sheet>
      {(home || visitedHome) && <div hidden={!home} className="h-full"><Workspace active={home}/></div>}
      {!home && <Outlet/>}
    </div>
  </div>;
}

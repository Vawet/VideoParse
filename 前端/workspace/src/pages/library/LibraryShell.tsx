import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, Film, Folder, Waypoints, MessageCircle, PanelLeft, Search, SquarePlay, Plus, Ellipsis, Eye, Pencil, Trash2 } from "lucide-react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useLibrary } from "./use-library";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PasteMarkdown } from "./PasteMarkdown";
import { LibraryItemDialog, type LibraryAction } from "./LibraryItemDialog";
import { LegacyImport } from "./LegacyImport";
import Workspace from "../workspace";

const row = "flex min-h-9 min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium outline-offset-1 hover:bg-sidebar-accent focus-visible:outline-ring";
const selected = "bg-primary/10 text-primary";
function LibraryList({onSelect}: {onSelect?: () => void}) {
  const {pathname, search, hash} = useLocation();
  const navigate = useNavigate();
  const [action, setAction] = useState<LibraryAction | null>(null);
  const [params] = useSearchParams();
  const {data, isPending, isError, refetch} = useLibrary();
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
    if (action.kind === "delete" && (pathname === target || (pathname === "/library" && isDocument))) {
      const removingCurrent = isDocument ? doc === action.id : pathname === target;
      void navigate(removingCurrent ? "/library" : pathname + search + hash, {
        replace: true, state: {libraryChange: Date.now()},
      });
    }
    setAction(null);
  }

  return <nav className="study-library-nav flex h-full min-w-0 flex-col text-sidebar-foreground" aria-label="资料库导航">
    <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
      <span className="relative grid size-9 shrink-0 place-items-center rounded-full border border-border bg-card">
        <Waypoints size={17} className="text-primary" aria-hidden/>
        <span className="absolute -bottom-px -right-px size-2 rounded-full bg-primary ring-2 ring-sidebar"/>
      </span>
      <span className="font-mono text-xs uppercase tracking-[0.23em]">VideoParse</span>
    </div>
    <div className="space-y-1 px-3 pt-2">
      <Link to="/" onClick={onSelect} aria-current={pathname === "/" ? "page" : undefined}
        className={cn(row, pathname === "/" && selected)}><SquarePlay size={17}/>视频工作台</Link>
      <Link to="/library" onClick={onSelect} aria-current={pathname === "/library" && !doc ? "page" : undefined}
        className={cn(row, pathname === "/library" && !doc && selected)}><MessageCircle size={17}/>资料问答与复习</Link>
    </div>
    <div className="px-5 pb-2 pt-7 text-[13px] font-semibold">资料库</div>
    <label className="mx-3 mb-3 flex min-h-8 items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
      <Search size={15}/><input type="search" value={filter} onChange={e=>{setFilter(e.target.value); if (e.target.value) setClosed({});}} aria-label="搜索资料库"
        placeholder="搜索视频或文档" className="min-w-0 flex-1 bg-transparent py-1 text-xs text-foreground outline-none"/>
    </label>
    <div className="vp-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4">
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
            <Folder size={17} className="text-primary"/>{folder.name}
            <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">{items.length}</span>
          </button>
          {video
            ? <Link to="/?add=video" onClick={onSelect} aria-label="新增视频" title="新增视频"
                className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-primary"><Plus size={16}/></Link>
            : <PasteMarkdown sidebar onSaved={id => {setFilter(""); setClosed({...closed,documents:false}); void refetch(); onSelect?.(); void navigate(docPath(id));}}/>}
          </div>
          {open && <ul className="ml-4 border-l border-border pl-2">
            {visible.map(item => {
              const url = video ? "/library/videos/" + encodeURIComponent(item.id) : docPath(item.id);
              const active = video ? pathname === url : pathname === "/library" && doc === item.id;
              const Icon = video ? Film : FileText;
              return <li key={item.id} className={cn("flex items-center rounded-lg",active && selected)}>
                <Link to={url} onClick={onSelect} title={item.name} aria-current={active ? "page" : undefined}
                  className={cn(row,"min-h-8 flex-1 font-normal")}><Icon size={14} className="shrink-0"/><span className="truncate">{item.name}</span></Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={item.name + " 的操作"} title="资料操作"
                      className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-primary"><Ellipsis size={15}/></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild><Link to={url} onClick={onSelect}><Eye size={15}/>查看</Link></DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setAction({folder:folder.id, ...item, kind:"rename"})}><Pencil size={15}/>重命名</DropdownMenuItem>
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
    {action && <LibraryItemDialog action={action} onClose={() => setAction(null)} onSaved={finishAction}/>}
    <div className="px-5 pb-5"><LegacyImport/></div>
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
  return <div className="study-shell flex h-dvh min-h-0 bg-background text-foreground">
    {open && <aside id="desktop-library" className="hidden w-[186px] shrink-0 border-r border-sidebar-border bg-sidebar md:block lg:w-[230px] xl:w-[250px]">
      <LibraryList/>
    </aside>}
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

import { Download, FileText, FolderOpen, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "./ThemeToggle";
import { ParseStatusBadge } from "./ParseStatusBadge";
import { useWorkspace } from "../hooks/use-workspace";

export function AppHeader() {
  const { title, lecture, status, available, exportNotes, exportMindmap, clearProject } =
    useWorkspace();

  return (
    <header className="relative z-40 flex h-16 shrink-0 items-center gap-3 border-b border-border/70 bg-background/80 px-3 backdrop-blur md:px-6">
      <button
        type="button"
        onClick={clearProject}
        className="group flex shrink-0 items-center gap-2.5 rounded-md text-left"
        title={status === "empty" ? "VideoParse" : "回到上传页"}
      >
        <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card">
          <Waypoints className="h-4 w-4 text-primary" aria-hidden />
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" aria-hidden />
        </span>
        <span className="hidden flex-col leading-none sm:flex">
          <span className="label-mono text-[8px] tracking-[0.26em]">N° 002 · Video</span>
          <span className="mt-1 font-mono text-[11px] uppercase tracking-[0.3em] text-foreground">
            Videoparse
          </span>
        </span>
      </button>

      <span className="hidden h-8 w-px bg-border md:block" aria-hidden />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm text-foreground/90">
            {status === "empty" ? "上传视频,开始解析" : title}
          </span>
          <ParseStatusBadge />
        </div>
        <p className="mt-0.5 hidden truncate text-[11px] text-muted-foreground md:block">
          {status === "empty" ? "把看完就忘的长视频,变成可检索、可复习的知识资产" : lecture.subtitle}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="group h-9 gap-2 rounded-full border-border/80 bg-transparent px-1.5 hover:bg-accent hover:text-accent-foreground sm:pl-3.5"
            >
              <span className="label-mono hidden text-[9px] text-foreground sm:inline">Export</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-200 ease-smooth group-hover:rotate-90">
                <Download className="h-3 w-3" aria-hidden />
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="label-mono text-[9px]">01 · Export</DropdownMenuLabel>
            <DropdownMenuItem className="gap-2" disabled={!available.notes} onSelect={exportNotes}>
              <FileText className="h-4 w-4 text-gold" aria-hidden />
              讲义 PDF(浏览器打印)
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2"
              disabled={!available.mindmap}
              onSelect={exportMindmap}
            >
              <Waypoints className="h-4 w-4 text-gold" aria-hidden />
              思维导图 PNG
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2"
              disabled={status === "empty"}
              onSelect={clearProject}
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
              换一个视频
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ThemeToggle />
      </div>
    </header>
  );
}

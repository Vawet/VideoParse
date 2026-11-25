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
  const { title, status, available, recent, reopen, exportNotes, exportMindmap, clearProject } =
    useWorkspace();

  return (
    <header className={`relative flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-3 backdrop-blur sm:pr-6 ${import.meta.env.VITE_PLATFORM === "true" ? "pl-14" : ""}`}>
      <div className="min-w-0 flex flex-1 items-center gap-2">
        <button type="button" onClick={clearProject} title="回到视频工作台" className="truncate text-left text-sm font-medium">
          {status === "empty" ? "视频工作台" : title}
        </button>
        {status !== "empty" && <ParseStatusBadge/>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              aria-label="导出"
              size="sm"
              className="group h-9 gap-2 rounded-full border-border/80 bg-transparent px-1.5 hover:bg-accent hover:text-accent-foreground sm:pl-3.5"
            >
              <span className="label-mono hidden text-[9px] text-foreground sm:inline">导出</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-200 ease-smooth group-hover:rotate-90">
                <Download className="h-3 w-3" aria-hidden />
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="label-mono text-[9px]">导出</DropdownMenuLabel>
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
        {import.meta.env.VITE_PLATFORM === "true" && recent.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm">最近解析</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-auto">
              <DropdownMenuLabel>此浏览器的任务</DropdownMenuLabel>
              {recent.map(row => <DropdownMenuItem key={row.taskId} onSelect={() => reopen(row)}>{row.name}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}

import {
  CalendarClock,
  FileText,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Presentation,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ResultKey } from "../data/types";
import { useWorkspace } from "../hooks/use-workspace";
import type { TabKey } from "../workspace-context";
import { ChatTab } from "../tabs/ChatTab";
import { MindmapTab } from "../tabs/MindmapTab";
import { NotesTab } from "../tabs/NotesTab";
import { OverviewTab } from "../tabs/OverviewTab";
import { QuizTab } from "../tabs/QuizTab";
import { ReviewTab } from "../tabs/ReviewTab";
import { SlidesTab } from "../tabs/SlidesTab";
import { TeachTab } from "../tabs/TeachTab";
import EvidencePanel from "./EvidencePanel";
import { TabPlaceholder } from "./TabPlaceholder";

type TabMeta = { key: TabKey; label: string; icon: LucideIcon; gate: ResultKey };

const TABS: TabMeta[] = [
  { key: "overview", label: "概览", icon: LayoutDashboard, gate: "chapters" },
  { key: "notes", label: "讲义", icon: FileText, gate: "notes" },
  { key: "mindmap", label: "思维导图", icon: Waypoints, gate: "mindmap" },
  { key: "slides", label: "PPT", icon: Presentation, gate: "slides" },
  { key: "chat", label: "问答", icon: MessageSquare, gate: "chat" },
  { key: "quiz", label: "测验", icon: ListChecks, gate: "quiz" },
  { key: "review", label: "复习", icon: CalendarClock, gate: "review" },
  { key: "teach", label: "讲授", icon: GraduationCap, gate: "teach" },
];

/** Learning tools with platform-backed views for uploaded videos. */
const LEARNING_TABS: TabKey[] = ["quiz", "review", "teach"];

const CONTENT: Record<TabKey, React.ComponentType> = {
  overview: OverviewTab,
  notes: NotesTab,
  mindmap: MindmapTab,
  slides: SlidesTab,
  chat: ChatTab,
  quiz: QuizTab,
  review: ReviewTab,
  teach: TeachTab,
};

/** The eight result views, numbered like a table of contents. */
export function ResultTabs() {
  const { activeTab, setActiveTab, available, unlockingKeys, isLive, videoId, seekTo } = useWorkspace();

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as TabKey)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList
        aria-label="解析结果"
        className="vp-scroll h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto rounded-none border-b border-border/70 bg-transparent p-0 px-2 md:px-4"
      >
        {TABS.map((tab, index) => {
          const unlocked = available[tab.gate];
          const unlocking = !unlocked && unlockingKeys.includes(tab.gate);
          const Icon = tab.icon;
          return (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className={cn(
                "group relative -mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-2.5 py-3 text-[13px] font-normal text-muted-foreground shadow-none transition-colors duration-200 ease-smooth hover:text-foreground",
                "data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none",
              )}
            >
              <span
                className={cn(
                  "font-mono text-[9px] tracking-[0.12em]",
                  unlocked ? "text-gold/75" : "text-muted-foreground/45",
                  "group-data-[state=active]:text-primary",
                )}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {tab.label}
              {!unlocked ? (
                unlocking ? (
                  <span className="h-1 w-1 animate-live-pulse rounded-full bg-warning" aria-hidden />
                ) : (
                  <span className="h-1 w-1 rounded-full bg-border" aria-hidden />
                )
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <div className="vp-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-5 md:py-5">
        {TABS.map((tab) => {
          const Content = CONTENT[tab.key];
          return (
            <TabsContent
              key={tab.key}
              value={tab.key}
              className="mt-0 animate-fade-in focus-visible:outline-none"
            >
              {isLive && videoId && import.meta.env.VITE_PLATFORM === "true" && available[tab.gate] && LEARNING_TABS.includes(tab.key) ? (
                <EvidencePanel video={videoId} view={tab.key} seek={seekTo} />
              ) : isLive && LEARNING_TABS.includes(tab.key) ? (
                <TabPlaceholder label={tab.label} unsupported />
              ) : available[tab.gate] ? (
                <Content />
              ) : (
                <TabPlaceholder label={tab.label} />
              )}
            </TabsContent>
          );
        })}
      </div>
    </Tabs>
  );
}

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
import { useLayoutEffect, useRef } from "react";
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

/** A shared indicator follows the selected learning view. */
export function ResultTabs() {
  const { activeTab, setActiveTab, available, unlockingKeys, isLive, videoId, seekTo } = useWorkspace();

  const highlight = useRef<HTMLSpanElement>(null);
  const previousTab = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const pill = highlight.current;
    const tab = pill?.parentElement;
    const previous = previousTab.current;
    if (!pill || !tab) return;
    previousTab.current = tab;
    if (!previous || previous === tab || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = previous.getBoundingClientRect();
    const to = tab.getBoundingClientRect();
    if (!to.width || !from.width) return;
    const animation = pill.animate([
      {transform: `translateX(${from.left - to.left}px) scaleX(${from.width / to.width})`},
      {transform: "none"},
    ], {duration: 270, easing: "cubic-bezier(.2,.8,.2,1)"});
    return () => animation.cancel();
  }, [activeTab]);
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as TabKey)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList
        aria-label="解析结果"
        className="result-tabs vp-scroll"
      >
        {TABS.map(tab => {
          const unlocked = available[tab.gate];
          const unlocking = !unlocked && unlockingKeys.includes(tab.gate);
          const Icon = tab.icon;
          return (
            <TabsTrigger key={tab.key} value={tab.key} className="result-tab">
              {activeTab === tab.key && <span ref={highlight} aria-hidden className="result-tab-pill"/>}
              <Icon size={15} aria-hidden/><span>{tab.label}</span>
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
              className="result-content mt-0 focus-visible:outline-none"
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

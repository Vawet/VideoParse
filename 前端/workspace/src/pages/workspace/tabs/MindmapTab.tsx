import { useCallback, useEffect, useState } from "react";
import { Download, Minimize2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MindmapNode, Segment } from "../data/types";
import { MindmapCanvas } from "../components/MindmapCanvas";
import { useWorkspace } from "../hooks/use-workspace";

/** Depth-first path from the root to the first node that sits inside `segment`. */
function findPathForSegment(root: MindmapNode, segment: Segment): string[] | null {
  let result: string[] | null = null;

  const walk = (node: MindmapNode, path: string[]) => {
    if (result) return;
    const next = [...path, node.id];
    if (typeof node.time === "number" && node.time >= segment.start && node.time < segment.end) {
      result = next;
      return;
    }
    node.children?.forEach((child) => walk(child, next));
  };

  walk(root, []);
  return result;
}

function allCollapsibleIds(node: MindmapNode, out: string[] = []): string[] {
  if ((node.children?.length ?? 0) > 0) {
    out.push(node.id);
    node.children?.forEach((child) => allCollapsibleIds(child, out));
  }
  return out;
}

export function MindmapTab() {
  const { lecture, focusRequest, seekTo, exportMindmap } = useWorkspace();
  const branchIds = lecture.mindmap.children?.map((child) => child.id) ?? [];
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(branchIds));
  const [selectedId, setSelectedId] = useState<string | null>(lecture.mindmap.id);

  // Any jump made elsewhere expands the matching branch and highlights the node.
  useEffect(() => {
    if (!focusRequest) return;
    const segment = lecture.segments.find((item) => item.id === focusRequest.segmentId);
    if (!segment) return;
    const path = findPathForSegment(lecture.mindmap, segment);
    if (!path) return;
    setCollapsed((previous) => {
      const next = new Set(previous);
      path.forEach((id) => next.delete(id));
      return next;
    });
    setSelectedId(path[path.length - 1]);
  }, [focusRequest, lecture]);

  const toggleCollapse = useCallback((nodeId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (node: MindmapNode) => {
      setSelectedId(node.id);
      if (typeof node.time !== "number") return;
      const segment = lecture.segments.find(
        (item) => node.time! >= item.start && node.time! < item.end,
      );
      seekTo(node.time, { segmentId: segment?.id });
    },
    [lecture.segments, seekTo],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="tool-heading">课程结构图</h2>
        <span className="text-[11px] text-muted-foreground">
          {lecture.segments.length} 个章节 · 点击节点联动视频
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 rounded-full text-[11px]"
            onClick={() => setCollapsed(new Set(branchIds))}
          >
            <Minimize2 className="h-3.5 w-3.5" aria-hidden />
            折叠一级
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 rounded-full text-[11px]"
            onClick={() => setCollapsed(new Set())}
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            全部展开
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 rounded-full text-[11px]" onClick={exportMindmap}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            导出图片
          </Button>
        </div>
      </div>

      <MindmapCanvas
        root={lecture.mindmap}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        selectedId={selectedId}
        onSelect={handleSelect}
      />

      <p className="label-mono text-[8px]">
        共 {allCollapsibleIds(lecture.mindmap).length + 1} 个节点(含根节点);导出的 PNG 只包含当前展开的部分。
      </p>
    </div>
  );
}

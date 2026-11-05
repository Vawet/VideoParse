import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clamp, formatTime } from "@/lib/format";
import type { MindmapNode } from "../data/types";
import { useThemeColors } from "../hooks/use-theme-colors";
import { useWorkspace } from "../hooks/use-workspace";

const NODE_H = 38;
const COL_PITCH = 300;
const ROW_GAP = 14;
const PAD = 18;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.8;

type PositionedNode = {
  node: MindmapNode;
  x: number;
  y: number;
  width: number;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
};

const widthForDepth = (depth: number) => (depth === 0 ? 272 : 196);

const truncate = (label: string, limit: number) =>
  label.length > limit ? `${label.slice(0, limit)}…` : label;

/** Tidy horizontal tree: leaves stack vertically, parents centre on their children. */
function layout(root: MindmapNode, collapsed: Set<string>) {
  const nodes: PositionedNode[] = [];
  let leaves = 0;

  const walk = (node: MindmapNode, depth: number): number => {
    const isCollapsed = collapsed.has(node.id);
    const children = isCollapsed ? [] : (node.children ?? []);
    const width = widthForDepth(depth);
    const x = PAD + depth * COL_PITCH;
    let y: number;

    if (children.length === 0) {
      y = PAD + leaves * (NODE_H + ROW_GAP) + NODE_H / 2;
      leaves += 1;
    } else {
      const childYs = children.map((child) => walk(child, depth + 1));
      y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    }

    nodes.push({
      node,
      x,
      y,
      width,
      depth,
      hasChildren: (node.children?.length ?? 0) > 0,
      collapsed: isCollapsed,
    });
    return y;
  };

  walk(root, 0);

  const width = Math.max(...nodes.map((item) => item.x + item.width)) + PAD;
  const height = Math.max(...nodes.map((item) => item.y + NODE_H / 2)) + PAD;
  return { nodes, width, height };
}

type MindmapCanvasProps = {
  root: MindmapNode;
  collapsed: Set<string>;
  onToggleCollapse: (nodeId: string) => void;
  selectedId: string | null;
  onSelect: (node: MindmapNode) => void;
};

/** Pan/zoom SVG tree. Drawn with inline colours so it can also be exported as PNG. */
export function MindmapCanvas({
  root,
  collapsed,
  onToggleCollapse,
  selectedId,
  onSelect,
}: MindmapCanvasProps) {
  const colors = useThemeColors();
  const { registerMindmapSvg, lecture, activeSegmentId } = useWorkspace();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const centeredFor = useRef<string | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const { nodes, width, height } = useMemo(() => layout(root, collapsed), [root, collapsed]);

  useEffect(() => {
    registerMindmapSvg(svgRef.current);
    return () => registerMindmapSvg(null);
  }, [registerMindmapSvg]);

  // Ctrl/⌘ + wheel zooms; the listener is non-passive so the page does not scroll.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((value) => clamp(value * (event.deltaY < 0 ? 1.1 : 0.9), MIN_ZOOM, MAX_ZOOM));
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // Keep a newly selected node in view.
  useEffect(() => {
    if (!selectedId || centeredFor.current === selectedId) return;
    const target = nodes.find((item) => item.node.id === selectedId);
    const container = containerRef.current;
    if (!target || !container) return;
    centeredFor.current = selectedId;
    const maxY = 8;
    const minY = Math.min(maxY, container.clientHeight - height * zoom - 8);
    setPan({ x: 8, y: clamp(container.clientHeight / 2 - target.y * zoom, minY, maxY) });
  }, [height, nodes, selectedId, zoom]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if ((event.target as Element).closest("[data-mindmap-node]")) return;
      dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [pan.x, pan.y],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({ x: drag.panX + (event.clientX - drag.x), y: drag.panY + (event.clientY - drag.y) });
  }, []);

  const activeSegment = lecture.segments.find((segment) => segment.id === activeSegmentId);
  const resetView = () => {
    setZoom(1);
    setPan({ x: 8, y: 8 });
  };

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (dragRef.current = null)}
        onPointerCancel={() => (dragRef.current = null)}
        className="relative h-[26rem] cursor-grab overflow-hidden rounded-lg border border-border bg-gradient-surface active:cursor-grabbing md:h-[30rem]"
      >
        <div
          className="absolute left-0 top-0 origin-top-left transition-transform duration-200 ease-smooth"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="课程思维导图"
            fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', sans-serif"
          >
            <rect x={0} y={0} width={width} height={height} rx={14} fill={colors.background} />

            {nodes.map((item) => {
              const parentNode = nodes.find(
                (candidate) => candidate.node.children?.some((child) => child.id === item.node.id),
              );
              if (!parentNode) return null;
              const startX = parentNode.x + parentNode.width;
              const endX = item.x;
              const midX = (startX + endX) / 2;
              return (
                <path
                  key={`edge-${item.node.id}`}
                  d={`M ${startX} ${parentNode.y} C ${midX} ${parentNode.y}, ${midX} ${item.y}, ${endX} ${item.y}`}
                  fill="none"
                  stroke={colors.border}
                  strokeWidth={1.5}
                />
              );
            })}

            {nodes.map((item) => {
              const isSelected = item.node.id === selectedId;
              const isInActiveSegment =
                typeof item.node.time === "number" &&
                activeSegment !== undefined &&
                item.node.time >= activeSegment.start &&
                item.node.time < activeSegment.end;
              const fill = isSelected ? colors.primary : isInActiveSegment ? colors.soft : colors.card;
              const textColor = isSelected ? colors.primaryForeground : colors.foreground;
              const timeColor = isSelected ? colors.primaryForeground : colors.gold;
              const label = truncate(item.node.label, item.depth === 0 ? 22 : 13);

              return (
                <g
                  key={item.node.id}
                  data-mindmap-node={item.node.id}
                  transform={`translate(${item.x}, ${item.y - NODE_H / 2})`}
                >
                  <rect
                    width={item.width}
                    height={NODE_H}
                    rx={9}
                    fill={fill}
                    stroke={isSelected ? colors.primary : isInActiveSegment ? colors.primary : colors.border}
                    strokeWidth={isInActiveSegment || isSelected ? 1.5 : 1}
                    className="cursor-pointer"
                    onClick={() => onSelect(item.node)}
                  />
                  <text
                    x={14}
                    y={NODE_H / 2 + 4}
                    fontSize={12.5}
                    fill={textColor}
                    className="cursor-pointer select-none"
                    onClick={() => onSelect(item.node)}
                  >
                    {label}
                  </text>
                  {typeof item.node.time === "number" && item.node.time > 0 ? (
                    <text
                      x={item.width - 12}
                      y={NODE_H / 2 + 4}
                      fontSize={10.5}
                      fill={timeColor}
                      textAnchor="end"
                      className="cursor-pointer select-none"
                      onClick={() => onSelect(item.node)}
                    >
                      {formatTime(item.node.time)}
                    </text>
                  ) : null}
                  {item.hasChildren ? (
                    <g
                      className="cursor-pointer"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleCollapse(item.node.id);
                      }}
                      role="button"
                      aria-label={`${item.collapsed ? "展开" : "折叠"}${item.node.label}`}
                    >
                      <circle
                        cx={item.width}
                        cy={NODE_H / 2}
                        r={9}
                        fill={colors.card}
                        stroke={colors.border}
                        strokeWidth={1}
                      />
                      <text
                        x={item.width}
                        y={NODE_H / 2 + 4}
                        fontSize={12}
                        textAnchor="middle"
                        fill={colors.mutedForeground}
                        className="select-none"
                      >
                        {item.collapsed ? "+" : "–"}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>

        <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-border bg-card/90 p-1 shadow-soft backdrop-blur">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="缩小"
            onClick={() => setZoom((value) => clamp(value / 1.2, MIN_ZOOM, MAX_ZOOM))}
          >
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <span className="w-10 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="放大"
            onClick={() => setZoom((value) => clamp(value * 1.2, MIN_ZOOM, MAX_ZOOM))}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="重置视图"
            onClick={resetView}
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <p className="label-mono text-[8px] leading-relaxed">
        点节点跳转视频 · + / − 折叠分支 · 拖拽平移 · Ctrl(⌘)+ 滚轮缩放
      </p>
    </div>
  );
}

import { memo, useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { Segment, Slide } from "../data/types";
import { SlideFigure } from "./SlideFigure";
import { TimestampChip } from "./TimestampChip";

type NotesArticleProps = {
  markdown: string;
  segments: Segment[];
  slides: Slide[];
  highlightSegmentId: string | null;
  onJump: (seconds: number) => void;
  onOpenSlide: (index: number) => void;
};

/** Flattens heading children so a heading can be matched back to its segment. */
function nodeToText(children: React.ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(nodeToText).join("");
  if (children && typeof children === "object" && "props" in children) {
    const props = (children as { props?: { children?: React.ReactNode } }).props;
    return nodeToText(props?.children);
  }
  return "";
}

/**
 * Renders the generated Markdown notes. Memoised because it re-renders on every
 * segment change while the video plays, and parsing Markdown on each tick is expensive.
 */
export const NotesArticle = memo(function NotesArticle({
  markdown,
  segments,
  slides,
  highlightSegmentId,
  onJump,
  onOpenSlide,
}: NotesArticleProps) {
  const components = useMemo<Components>(() => {
    const titleIndex = new Map(
      segments.map((segment) => [segment.title.replace(/\s+/g, ""), segment.id]),
    );

    return {
      h2: ({ children }) => {
        const key = nodeToText(children).replace(/\s+/g, "");
        const segmentId = titleIndex.get(key);
        return (
          <h2
            id={segmentId ? `seg-${segmentId}` : undefined}
            className={cn(
              "rounded-sm transition-colors duration-200 ease-smooth",
              segmentId && segmentId === highlightSegmentId
                ? "text-gold [box-shadow:inset_2px_0_0_hsl(var(--gold))] pl-3 -ml-3"
                : undefined,
            )}
          >
            {children}
          </h2>
        );
      },
      a: ({ href, children }) => {
        if (href?.startsWith("#t=")) {
          return <TimestampChip seconds={Number(href.slice(3))} onJump={onJump} />;
        }
        return (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      },
      // An image paragraph becomes a <figure>; a <figure> may not sit inside a <p>,
      // so those paragraphs are rendered as a plain block instead.
      p: ({ children, node }) => {
        const nodes = (
          node as { children?: { type?: string; tagName?: string; properties?: { src?: unknown } }[] }
        )?.children;
        const holdsSlide = nodes?.some(
          (child) =>
            child.type === "element" &&
            child.tagName === "img" &&
            typeof child.properties?.src === "string" &&
            child.properties.src.startsWith("#slide-"),
        );
        return holdsSlide ? <div className="not-prose">{children}</div> : <p>{children}</p>;
      },
      img: ({ src, alt }) => {
        const id = typeof src === "string" && src.startsWith("#slide-") ? src.slice(7) : null;
        const slide =
          slides.find((item) => item.id === id) ??
          slides.find((item) => item.title === alt) ??
          slides[0];
        if (!slide) return null;
        return (
          <SlideFigure
            slide={slide}
            onJump={onJump}
            onOpen={() => onOpenSlide(slides.indexOf(slide))}
          />
        );
      },
      table: (props) => (
        <div className="not-prose my-5 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm" {...props} />
        </div>
      ),
      thead: (props) => <thead className="bg-muted/60 text-left" {...props} />,
      code: ({ children, className }) => (
        <code
            className={cn(
              "rounded border border-border/60 bg-secondary/70 px-1.5 py-0.5 font-mono text-[0.85em] font-normal text-gold-soft-foreground",
              className,
            )}
        >
          {children}
        </code>
      ),
    };
  }, [highlightSegmentId, onJump, onOpenSlide, segments, slides]);

  return (
    <article className="prose-vp prose max-w-none dark:prose-invert">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </Markdown>
    </article>
  );
});

import { memo, useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { TimestampChip } from "./TimestampChip";

const CLOCK = /\[?(?<![\d:])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])\]?/g;

/** Turns bare "[00:00:07]" / "00:07" into timestamp links, and splits run-on numbered points. */
export function prepareAnswer(text: string): string {
  return text
    .replace(CLOCK, (_match, a: string, b: string, c?: string) => {
      const seconds =
        c === undefined ? Number(a) * 60 + Number(b) : Number(a) * 3600 + Number(b) * 60 + Number(c);
      return `[${seconds}](#t=${seconds})`;
    })
    .replace(/[ \t]*(\*\*\d+[.、．])/g, "\n\n$1")
    .trim();
}

type ChatMarkdownProps = { text: string; onJump: (seconds: number) => void };

/** Renders an AI answer as formatted text; every timestamp becomes a clickable capsule. */
export const ChatMarkdown = memo(function ChatMarkdown({ text, onJump }: ChatMarkdownProps) {
  const source = useMemo(() => prepareAnswer(text), [text]);
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) =>
        href?.startsWith("#t=") ? (
          <TimestampChip
            seconds={Number(href.slice(3))}
            onJump={onJump}
            className="mx-0.5 align-baseline"
          />
        ) : (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        ),
    }),
    [onJump],
  );

  return (
    <div className="prose prose-sm max-w-none text-[13.5px] leading-[1.85] dark:prose-invert prose-p:my-2 prose-strong:font-medium prose-strong:text-foreground prose-ol:my-2 prose-ul:my-2 prose-li:my-1 prose-headings:font-medium">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </Markdown>
    </div>
  );
});

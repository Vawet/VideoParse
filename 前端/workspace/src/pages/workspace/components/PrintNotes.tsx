import { useWorkspace } from "../hooks/use-workspace";
import { NotesArticle } from "./NotesArticle";

/**
 * Off-screen copy of the notes that only exists while a PDF export is running.
 * The print stylesheet makes it the sole visible element on the page.
 */
export function PrintNotes() {
  const { printMode, lecture } = useWorkspace();
  if (!printMode) return null;

  return (
    <div className="print-notes fixed left-[-10000px] top-0 w-[820px] opacity-0">
      <h1 className="mb-1 text-xl font-semibold">{lecture.title}</h1>
      <p className="mb-4 text-xs text-muted-foreground">
        {lecture.subtitle} · VideoParse 自动生成讲义 · 时长 {Math.round(lecture.duration / 60)} 分钟
      </p>
      <NotesArticle
        markdown={lecture.notesMarkdown}
        segments={lecture.segments}
        slides={lecture.slides}
        highlightSegmentId={null}
        onJump={() => undefined}
        onOpenSlide={() => undefined}
      />
    </div>
  );
}

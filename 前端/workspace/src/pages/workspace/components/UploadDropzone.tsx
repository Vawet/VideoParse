import { useRef, useState } from "react";
import { ArrowUpRight, FlaskConical, FolderUp, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../hooks/use-workspace";

const ACCEPTED = [".mp4", ".mov", ".mkv", ".webm", ".m4v"];
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

export function UploadDropzone() {
  const { uploadFile, startDemo, startFailureDemo } = useWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (file: File) => {
    const name = file.name.toLowerCase();
    if (!ACCEPTED.some((extension) => name.endsWith(extension))) {
      toast.error("暂不支持这个格式,请上传 MP4 / MOV / MKV / WebM 视频。");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("文件超过 2 GB,请先压缩或截取片段后再上传。");
      return;
    }
    uploadFile(file);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-6">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) accept(file);
        }}
        className={cn(
          "frame-brackets relative flex flex-1 flex-col justify-start gap-7 overflow-hidden rounded-xl border border-dashed p-6 transition-colors duration-200 ease-smooth md:p-8",
          dragging
            ? "border-primary/70 bg-primary-soft"
            : "border-border/70 bg-card/30 hover:border-border",
        )}
      >
        <div className="ambient-glow pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <span
          className="display pointer-events-none absolute -bottom-8 right-2 select-none text-[7rem] leading-none text-foreground/[0.045]"
          aria-hidden
        >
          01
        </span>

        <div className="relative space-y-3">
          <div className="flex items-center gap-2">
            <span className="label-mono text-[9px]">01 · Input</span>
            <span className="h-px flex-1 bg-border/70" aria-hidden />
            <span className="label-mono text-[9px]">Video file</span>
          </div>
          <h2 className="display text-[1.6rem] leading-[1.28] text-foreground md:text-[1.95rem]">
            把视频拖到这里,
            <br />
            剩下的交给 <span className="text-primary">Agent</span>。
          </h2>
          <p className="max-w-sm text-[12px] leading-[1.85] text-muted-foreground">
            课程、讲座、PPT 讲解、口播都可以。解析完成后,你会拿到讲义、导图、关键帧、问答与复习材料。
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {["MP4", "MOV", "MKV", "WEBM"].map((format) => (
              <span
                key={format}
                className="rounded-full border border-border/70 px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground"
              >
                {format}
              </span>
            ))}
            <span className="ml-1 font-mono text-[9px] text-gold/80">≤ 2 GB</span>
          </div>
        </div>

        <div className="relative flex flex-wrap items-center gap-2.5">
          <Button
            className="group h-10 gap-2 rounded-full bg-primary pl-5 pr-1.5 text-primary-foreground hover:bg-primary/90"
            onClick={() => inputRef.current?.click()}
          >
            <span className="text-[13px] font-medium">选择视频文件</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-foreground/15">
              <FolderUp className="h-3.5 w-3.5" aria-hidden />
            </span>
          </Button>
          <Button
            variant="outline"
            className="group h-10 gap-2 rounded-full border-border bg-transparent pl-5 pr-1.5 text-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={startDemo}
          >
            <span className="text-[13px]">使用示例视频</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gold/40 text-gold">
              <Play className="h-3 w-3" aria-hidden />
            </span>
          </Button>
        </div>

        <div className="relative mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 pt-3">
          <span className="label-mono text-[8px]">02 · Upload tips</span>
          <span className="text-[10px] text-muted-foreground">视频只在本机预览,解析结果来自内置示例数据</span>
          <button
            type="button"
            onClick={startFailureDemo}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] text-muted-foreground transition-colors duration-200 ease-smooth hover:bg-accent hover:text-accent-foreground"
          >
            <FlaskConical className="h-3 w-3" aria-hidden />
            查看解析失败示例
            <ArrowUpRight className="h-3 w-3 opacity-60" aria-hidden />
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) accept(file);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

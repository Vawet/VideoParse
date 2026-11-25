import { useRef, useState } from "react";
import { FolderUp, CloudUpload, FlaskConical, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import demoPreview from "@/assets/demo-slides/slide-2.webp";
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
    <div className="study-upload mt-7 grid items-stretch gap-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section
        aria-label="导入视频"
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) accept(e.dataTransfer.files[0]); }}
        className={cn("frame-brackets flex flex-col items-center justify-center rounded-xl border border-dashed px-5 py-8 text-center transition-colors",
          dragging ? "border-primary bg-primary/10" : "border-primary/35 bg-primary/[0.035]")}>
        <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><CloudUpload size={26}/></span>
        <h2 className="display text-[1.65rem] leading-tight">把视频拖到这里</h2>
        <p className="mb-5 mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">MP4 · MOV · MKV · WebM · M4V <span className="text-gold">≤ 2 GB</span></p>
        <Button onClick={()=>inputRef.current?.click()} className="gap-2 rounded-full px-5"><FolderUp size={15}/>选择视频文件</Button>
        <input ref={inputRef} aria-label="选择视频" type="file" accept={ACCEPTED.join(",")} className="hidden"
          onChange={e=>{const file=e.target.files?.[0]; if (file) accept(file); e.target.value="";}}/>
      </section>
      <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
        <button type="button" onClick={startDemo} aria-label="使用示例视频" className="group block h-full w-full text-left">
          <div className="relative h-32 overflow-hidden bg-muted md:h-36">
            <img src={demoPreview} alt="示例课中的 Q、K、V 讲解幻灯片" className="size-full object-cover object-center"/>
            <span className="absolute bottom-3 right-3 grid size-8 place-items-center rounded-full bg-black/65 text-white"><Play size={15} fill="currentColor"/></span>
          </div>
          <div className="space-y-1.5 px-5 py-4">
            <p className="font-mono text-xs text-gold">示例课程 · 46 分钟</p>
            <h2 className="display text-xl leading-snug">注意力机制与 Transformer 入门</h2>
            <span className="inline-block text-xs font-medium text-primary group-hover:underline">使用示例视频</span>
          </div>
        </button>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground sm:col-span-2">
        <span>{import.meta.env.VITE_PLATFORM === "true" ? "解析完成后，视频会自动归入资料库。" : "支持上传本机视频或体验内置示例。"}</span>
        <button type="button" onClick={startFailureDemo} className="inline-flex items-center gap-1.5 hover:text-primary"><FlaskConical size={13}/>查看解析失败示例</button>
      </div>
    </div>
  );
}

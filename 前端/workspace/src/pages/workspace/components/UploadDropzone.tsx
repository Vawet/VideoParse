import { useRef, useState } from "react";
import { ArrowUpRight, FilePlus2, FlaskConical, MessagesSquare, Film, Upload } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/sonner";
import { PasteMarkdown } from "../../library/PasteMarkdown";
import { libraryKey } from "../../library/use-library";
import { useWorkspace } from "../hooks/use-workspace";
import { CourseCover } from "./CourseCover";

const ACCEPTED = [".mp4", ".mov", ".mkv", ".webm", ".m4v"];
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const platform = import.meta.env.VITE_PLATFORM === "true";

export function UploadDropzone({onStart}: {onStart?: () => void}) {
  const { uploadFile, startDemo, startFailureDemo, setActiveTab } = useWorkspace();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function accept(file: File) {
    if (!ACCEPTED.some(extension => file.name.toLowerCase().endsWith(extension))) {
      toast.error("请选择 MP4、MOV、MKV、WebM 或 M4V 视频。");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("文件超过 2 GB，请先压缩或截取片段后再上传。");
      return;
    }
    onStart?.();
    void uploadFile(file);
  }
  function play() { onStart?.(); startDemo(); }

  return <>
    <CourseCover onPlay={play}/>
    <section className="start-section" aria-labelledby="start-heading">
      <h2 id="start-heading" className="section-title">快速开始</h2>
      <div className="quick-actions">
        <button type="button" className="action-card action-video" data-dragging={dragging} onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) accept(e.dataTransfer.files[0]); }}>
          <span className="action-icon"><Upload/></span><ArrowUpRight className="action-arrow"/>
          <strong>{dragging ? "松开即可导入" : "导入视频"}</strong><small>拖入或选择文件，最大 2 GB</small>
        </button>
        <input ref={inputRef} aria-label="选择视频" type="file" accept={ACCEPTED.join(",")} hidden
          onChange={e => { const file = e.target.files?.[0]; if (file) accept(file); e.target.value = ""; }}/>
        {platform ? <>
          <PasteMarkdown trigger={<button type="button" className="action-card action-doc">
            <span className="action-icon"><FilePlus2/></span><ArrowUpRight className="action-arrow"/>
            <strong>添加文档</strong><small>上传 Markdown 或粘贴笔记</small>
          </button>} onSaved={id => {
            void cache.invalidateQueries({queryKey: libraryKey()});
            void navigate("/library?doc=" + encodeURIComponent(id));
          }}/>
          <Link to="/library" className="action-card action-chat">
            <span className="action-icon"><MessagesSquare/></span><ArrowUpRight className="action-arrow"/>
            <strong>资料问答</strong><small>从笔记中查找答案和出处</small>
          </Link>
        </> : <>
          <button type="button" className="action-card action-doc" onClick={() => { play(); setActiveTab("notes"); }}>
            <span className="action-icon"><FilePlus2/></span><ArrowUpRight className="action-arrow"/>
            <strong>示例讲义</strong><small>按章节阅读图文与时间戳</small>
          </button>
          <button type="button" className="action-card action-chat" onClick={() => { play(); setActiveTab("chat"); }}>
            <span className="action-icon"><MessagesSquare/></span><ArrowUpRight className="action-arrow"/>
            <strong>视频问答</strong><small>围绕示例课程提问</small>
          </button>
        </>}
      </div>
    </section>
    <section className="course-tools" aria-label="解析示例">
      <Film size={15} aria-hidden/><p>支持 MP4、MOV、MKV、WebM 和 M4V</p>
      <button type="button" onClick={() => {onStart?.(); startFailureDemo();}}><FlaskConical size={14}/>解析失败示例</button>
    </section>
  </>;
}

import { useRef, useState, type FormEvent } from "react";
import { ClipboardPaste, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { uploadDocument } from "./api";

function markdownName(title: string) {
  const stem = title.trim().replace(/\.(?:md|markdown)$/i, "")
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ").trim().replace(/[. ]+$/, "");
  return Array.from(stem || "未命名笔记").slice(0, 230).join("") + ".md";
}

export function PasteMarkdown({disabled = false, sidebar = false, onSaved}: {disabled?: boolean; sidebar?: boolean; onSaved: (id: string) => void}) {
  const picker = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const heading = /^\s*#{1,6}[ \t]+([^\r\n]+)/.exec(markdown)?.[1] ?? "";
  const suggested = markdownName(heading.replace(/[ \t]+#+[ \t]*$/, ""));

  async function saveFile(file: File) {
    if (saving) return;
    if (file.size > 512 * 1024) {
      setError("每份 Markdown 上限 512 KiB，请拆分后保存。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const doc = await uploadDocument(file);
      setOpen(false);
      setMarkdown("");
      setName("");
      onSaved(doc.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (markdown.trim()) void saveFile(new File([markdown], name.trim() ? markdownName(name) : suggested, {type: "text/markdown;charset=utf-8"}));
  }

  return <Dialog open={open} onOpenChange={next => { if (!saving) setOpen(next); }}>
    <DialogTrigger asChild>
      {sidebar ? <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label="新增文档" title="新增文档"><Plus size={16}/></Button> :
      <Button size="sm" variant="outline" disabled={disabled} aria-label="粘贴 Markdown" title="粘贴 Markdown">
        <ClipboardPaste size={15}/><span className="hidden sm:inline">粘贴文本</span>
      </Button>}
    </DialogTrigger>
    <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl">
      <DialogHeader>
        <DialogTitle>{sidebar ? "新增文档" : "粘贴 Markdown"}</DialogTitle>
        <DialogDescription>保存为 .md 文档，加入你的资料库。</DialogDescription>
      </DialogHeader>
      {sidebar && <div>
        <Button variant="outline" size="sm" disabled={saving} onClick={() => picker.current?.click()}><Upload size={15}/>选择 Markdown 文件</Button>
        <input ref={picker} type="file" accept=".md,.markdown" aria-label="从本机添加 Markdown" hidden
          onChange={e => {const file=e.target.files?.[0]; e.target.value=""; if (file) void saveFile(file);}}/>
      </div>}
      <form onSubmit={save} className="space-y-4">
        <label className="block space-y-1.5 text-sm">
          <span>Markdown 正文</span>
          <Textarea rows={8} value={markdown} disabled={saving} required placeholder="在这里粘贴笔记…"
            onChange={e => {setMarkdown(e.target.value); setError("");}}/>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span>文件名（可选）</span>
          <Input value={name} disabled={saving} placeholder={suggested}
            onChange={e => {setName(e.target.value); setError("");}}/>
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">每份上限 512 KiB</span>
          <Button type="submit" disabled={saving || !markdown.trim()}>{saving ? "保存中…" : "保存到资料库"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

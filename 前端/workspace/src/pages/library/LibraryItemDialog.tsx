import { useState, type FormEvent } from "react";
import { changeLibraryItem, type LibraryFolder } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type LibraryAction = { folder: LibraryFolder["id"]; id: string; name: string; kind: "rename" | "delete" };

export function LibraryItemDialog({action, onClose, onSaved}: {
  action: LibraryAction; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(action.name);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rename = action.kind === "rename";
  const video = action.folder === "videos";
  const title = rename ? "重命名" : video ? "从资料库移除视频" : "删除文档";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (rename && !name.trim())) return;
    const value = name.trim();
    const filename = !video && !/\.(md|markdown)$/i.test(value) ? value + ".md" : value;
    setError(""); setBusy(true);
    try {
      await changeLibraryItem(action.folder, action.id, rename ? filename : undefined);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="w-[calc(100%-2rem)] rounded-xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="break-words">
          {rename ? action.name : video
            ? `移除「${action.name}」的归档条目。原片和课程记录会保留，再次解析成功后会重新归档。`
            : `「${action.name}」的原文、检索段落和关联复习卡将一并删除。`}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {rename && <label className="block space-y-1.5 text-sm"><span>{video ? "视频名称" : "文件名"}</span>
          <Input value={name} maxLength={video ? 300 : 239} required disabled={busy} onChange={e => setName(e.target.value)}/>
        </label>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button disabled={busy || (rename && !name.trim())} variant={rename ? "default" : "destructive"}>
            {busy ? "处理中…" : rename ? "保存名称" : video ? "确认移除" : "确认删除"}
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

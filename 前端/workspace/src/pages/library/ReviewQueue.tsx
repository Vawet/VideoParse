import { useEffect, useState } from "react";
import { Layers2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { libraryApi } from "./api";
import { sourceLabel, type Source } from "./source";

type Card = Source & {
  id: string; available: boolean; body: string;
  question: string; revision: number; dueEpoch: number; dueCount: number; total: number;
};

export function ReviewQueue({documentId, updated, openSource, onRemove}: {
  documentId?: string;
  updated: number;
  openSource: (source: Source) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revealed, setRevealed] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    const query = documentId ? "?" + new URLSearchParams({documentId}) : "";
    libraryApi<{next: Card | null}>("/review" + query).then(data => {
      if (current) { setCard(data.next); setLoaded(true); }
    }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [documentId, updated, revision]);
  useEffect(() => {
    if (!card || card.dueCount > 0) return;
    const delay = Math.max(1000, card.dueEpoch * 1000 - Date.now() + 1000);
    const timer = window.setTimeout(() => setRevision(r => r + 1), Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [card]);

  async function act(action: "again" | "remembered" | "remove") {
    if (!card || busy) return;
    setBusy(true); setError("");
    try {
      if (action === "remove") {
        await libraryApi("/review/" + card.id, {method: "DELETE"});
        onRemove();
      } else {
        await libraryApi("/review/" + card.id + "/rate", {method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({revision: card.revision, rating: action})});
      }
      setRevealed("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setRevision(r => r + 1); }
  }

  const key = card ? card.id + "/" + card.revision : "";
  const title = documentId ? "本篇复习" : "资料复习";
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" className="library-review-trigger" aria-label={title + (card ? `，${card.dueCount} 张待复习` : "")}>
        <Layers2 size={16}/>复习{card && card.dueCount > 0 && <span className="library-review-count">{card.dueCount}</span>}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} collisionPadding={10} aria-label={title}
      className="vp-scroll max-h-[var(--radix-popover-content-available-height)] w-[min(24rem,calc(100vw-1.25rem))] space-y-4 overflow-auto rounded-xl p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="review-title"><Layers2 size={18}/>{title}</h2>
        {card && <span className="text-xs text-muted-foreground">{card.dueCount} 张待复习 · 共 {card.total} 张</span>}
      </div>
      {error && <p role="alert" className="text-sm">{error} <button className="underline" onClick={() => {setError(""); setRevision(r=>r+1);}}>刷新</button></p>}
      {!card && <p className="text-sm text-muted-foreground">{loaded
        ? documentId ? "这篇笔记还没有复习卡。可从本篇的问答引用中加入。" : "在问答引用下点击「加入复习」保存第一张卡片。"
        : "正在读取复习队列…"}</p>}
      {card && <>
        {card.dueCount === 0 && <p className="text-sm text-muted-foreground">下次复习 · {new Date(card.dueEpoch * 1000).toLocaleString()}</p>}
        <p className="text-sm font-medium">{card.question}</p>
        {revealed === key && <blockquote className="whitespace-pre-wrap border-l-2 border-primary/40 pl-3 text-sm">{card.body}</blockquote>}
        <div className="flex flex-wrap items-center gap-3">
          {card.dueCount > 0 && (revealed !== key
            ? <Button size="sm" onClick={() => setRevealed(key)}>显示答案</Button>
            : <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("again")}>还没记住</Button>
              <Button size="sm" disabled={busy} onClick={() => void act("remembered")}>记住了</Button>
            </>)}
          <button className="text-xs text-primary underline" disabled={!card.available} onClick={() => {setOpen(false); openSource(card);}}>
            {card.available ? sourceLabel(card) : card.name + " · 来源已更新或正在索引"}
          </button>
          <button className="ml-auto text-xs text-muted-foreground underline" disabled={busy} onClick={() => void act("remove")}>移出复习</button>
        </div>
      </>}
    </PopoverContent>
  </Popover>;
}

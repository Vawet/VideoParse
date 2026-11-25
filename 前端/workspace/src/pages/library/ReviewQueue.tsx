import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "./api";

type Card = {
  id: string; docId: string; name: string; firstLine: number; lastLine: number; body: string;
  question: string; revision: number; dueEpoch: number; dueCount: number; total: number;
};

export function ReviewQueue({updated, openSource, onRemove}: {
  updated: number;
  openSource: (id: string, from: number, to: number) => void;
  onRemove: () => void;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revealed, setRevealed] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    api<{next: Card | null}>("/review").then(data => {
      if (current) { setCard(data.next); setLoaded(true); }
    }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [updated, revision]);
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
        await api("/review/" + card.id, {method: "DELETE"});
        onRemove();
      } else {
        await api("/review/" + card.id + "/rate", {method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({revision: card.revision, rating: action})});
      }
      setRevealed("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setRevision(r => r + 1); }
  }

  const key = card ? card.id + "/" + card.revision : "";
  return <section className="space-y-3 rounded-xl border border-border bg-card p-5" aria-label="文档复习">
    <div className="flex items-baseline justify-between">
      <h2 className="font-semibold">文档复习</h2>
      {card && <span className="text-xs text-muted-foreground">{card.dueCount} 张待复习 · 共 {card.total} 张</span>}
    </div>
    {error && <p role="alert" className="text-sm">{error} <button className="underline" onClick={() => {setError(""); setRevision(r=>r+1);}}>刷新</button></p>}
    {!card && <p className="text-sm text-muted-foreground">{loaded ? "在问答引用下点击「加入复习」保存第一张卡片。" : "正在读取复习队列…"}</p>}
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
        <button className="text-xs text-primary underline" onClick={() => openSource(card.docId, card.firstLine, card.lastLine)}>
          {card.name} · 第 {card.firstLine}–{card.lastLine} 行
        </button>
        <button className="ml-auto text-xs text-muted-foreground underline" disabled={busy} onClick={() => void act("remove")}>移出复习</button>
      </div>
    </>}
  </section>;
}

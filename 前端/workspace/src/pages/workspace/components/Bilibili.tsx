import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { API_BASE, getClientId, getUploadGate, verifyUploadGate } from "@/lib/api";
import type { RecentTask } from "@/lib/recent-tasks";
import { useWorkspace } from "../hooks/use-workspace";

async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(API_BASE + "/v2/" + path, body === undefined ? {} : {
    method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "B 站请求失败");
  return result;
}

export function BilibiliImport({onStart}: {onStart?: () => void}) {
  const {reopen} = useWorkspace();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const gate = await getUploadGate();
      let token = "";
      if (gate.required) {
        const answer = window.prompt(gate.question);
        if (answer === null) return;
        token = await verifyUploadGate(answer);
      }
      const row = await request<RecentTask>("bilibili/import", {url: url.trim(),token});
      onStart?.();
      reopen(row);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="my-4 space-y-2 rounded-xl border bg-card p-4">
    <label htmlFor="bili-url" className="flex items-center gap-2 text-sm font-semibold"><Link2 size={16}/>从 B 站链接解析</label>
    <div className="flex flex-wrap gap-2">
      <Input id="bili-url" type="url" required maxLength={2048} placeholder="粘贴视频页或 b23.tv 短链接"
        className="min-w-40 flex-1" disabled={busy} value={url} onChange={e=>setUrl(e.target.value)}/>
      <Button type="submit" disabled={busy || !url.trim()}>{busy ? "正在导入视频…" : "开始解析"}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}

type Analysis = {comments: {id: string; text: string}[]; claims: {id: number; answer: string; quote: string}[]; model_status: string};
type Source = {available: boolean; url?: string; analysis?: Analysis | null};

export function BilibiliComments({video}: {video: string}) {
  const path = "videos/" + encodeURIComponent(video) + "/bilibili";
  const key = ["bilibili",getClientId(),video];
  const cache = useQueryClient();
  const {data} = useQuery({queryKey:key, queryFn:()=>request<Source>(path), staleTime:60_000, retry:1});
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  if (!data?.available) return null;
  const analysis = data.analysis;
  async function analyze() {
    setBusy(true); setError("");
    try {
      const result = await request<Analysis>(path+"/comments",{});
      cache.setQueryData<Source>(key, previous=>previous && {...previous,analysis:result});
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog><DialogTrigger asChild><Button size="sm" variant="outline" className="self-start"><MessagesSquare size={15}/>B 站评论</Button></DialogTrigger>
    <DialogContent aria-describedby={undefined} className="vp-scroll max-h-[85dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>B 站评论分析</DialogTitle></DialogHeader>
      <a className="text-sm text-primary underline" href={data.url} target="_blank" rel="noreferrer">查看原视频和评论区</a>
      {analysis && <div className="space-y-3">
        <p className="text-sm text-muted-foreground">本次采样 {analysis.comments.length} 条公开热评</p>
        {analysis.claims.map((item,i)=><div key={i} className="space-y-1 text-sm"><p>{item.answer}</p>
          <blockquote className="border-l-2 pl-3 text-muted-foreground">[{item.id}] {item.quote}</blockquote></div>)}
        {!!analysis.comments.length && !analysis.claims.length && <p className="text-sm">{analysis.model_status === "unconfigured" ? "尚未配置文本模型，已列出评论原文。" : "本次未生成可核对的结论。"}</p>}
        <ol className="space-y-2 text-sm">{analysis.comments.map((row,i)=><li key={row.id}>[{i+1}] {row.text}</li>)}</ol>
      </div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!analysis?.claims.length && <Button disabled={busy} onClick={()=>void analyze()}>{busy?"正在读取并分析…":"分析公开热评"}</Button>}
    </DialogContent>
  </Dialog>;
}

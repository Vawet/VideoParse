import { Activity, ChevronRight, ReceiptText } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readApiUsage, type UsageReceipt } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const number = new Intl.NumberFormat("zh-CN");
const usd = new Intl.NumberFormat("zh-CN", {style:"currency", currency:"USD", maximumFractionDigits:6});
const date = new Intl.DateTimeFormat("zh-CN", {year:"numeric", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit"});
const labels: Record<string,string> = {
  analyze:"视频解析", analyze_sync:"视频解析", model_call:"模型调用", repair:"解析修复", chat:"学习问答",
  analyze_structure:"章节分析", correct_transcript:"字幕校正", generate_summary:"视频摘要", generate_mindmap:"思维导图",
  write_frame_notes:"画面笔记", view_frame:"查看画面", capture_frame:"画面问答", generate_quiz:"生成测验",
  document_answer:"文档问答", document_web_sources:"联网检索", document_interview:"知识库面试", document_route:"资料来源判断",
  search_if_requested:"联网问答", document_index:"文档索引", document_remove:"文档索引清理", document_search:"文档检索",
  evidence_search:"视频证据检索", evidence_answer:"视频证据问答", quiz_generate:"生成测验", verify:"核对说法",
  teach_plan:"生成教案", teach_plan_revise:"修订教案", review_plan:"复习计划", bilibili_comments:"B 站评论分析",
  build_review_plan:"复习计划", verify_claim:"核对说法", get_keywords:"提取关键词",
};
const statusText: Record<string,string> = {
  failed_reported:"请求失败 · 已返回用量", failed_partial:"请求失败 · 用量仅部分返回",
  awaiting:"等待回执", failed:"请求失败 · 扣费待核对", unreported:"供应商未返回用量", partial:"用量仅部分返回",
};

function Receipt({item}: {item:UsageReceipt}) {
  const counts = [
    item.input_tokens !== null && "输入 " + number.format(item.input_tokens),
    item.output_tokens !== null && "输出 " + number.format(item.output_tokens),
  ].filter(Boolean).join(" · ");
  return <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border py-3 last:border-0">
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{labels[item.operation] || item.operation}</p>
      <p className="break-all text-xs text-muted-foreground">{item.model} · {item.provider}</p>
      <time className="text-[11px] text-muted-foreground" dateTime={new Date(item.started_ms).toISOString()}>{date.format(item.started_ms)}</time>
    </div>
    <div className="text-right text-xs tabular-nums">
      {item.total_tokens !== null && <p className="font-semibold">{number.format(item.total_tokens)} token</p>}
      {counts && <p className="text-muted-foreground">{counts}</p>}
      {item.estimated_usd_micros !== null && <p className="font-semibold">估算 {usd.format(item.estimated_usd_micros / 1e6)}</p>}
      {statusText[item.status] && <p className="text-muted-foreground">{statusText[item.status]}</p>}
    </div>
  </li>;
}

export function ApiUsageBar() {
  const [open,setOpen] = useState(false);
  const [pages,setPages] = useState<(number|null)[]>([null]);
  const before = pages[pages.length-1];
  const {data,isError,refetch} = useQuery({
    queryKey:["api-usage",before], queryFn:({signal})=>readApiUsage(before, signal), refetchInterval:5000, retry:1,
  });
  const summary = data?.summary;
  return <footer className="shrink-0 border-t border-border bg-background px-3 py-0.5 text-foreground print:hidden sm:px-5">
    <Dialog open={open} onOpenChange={value=>{setOpen(value); if (!value) setPages([null]);}}>
      <DialogTrigger asChild>
        <button type="button" aria-label="查看 API 用量明细"
          className="flex min-h-8 w-full flex-wrap items-center justify-end gap-x-2 rounded-md px-1 text-[11px] text-muted-foreground tabular-nums hover:bg-accent focus-visible:outline-ring sm:gap-x-3 sm:text-xs">
          <span className="mr-auto inline-flex items-center gap-1.5 font-medium text-foreground"><Activity size={14}/>API 用量</span>
          {isError ? <span>读取失败</span> : summary ? <>
            <span>{number.format(summary.requests)} 次</span>
            <span className="font-medium text-foreground">{number.format(summary.tokens)} token</span>
            {summary.estimated_usd_micros > 0 && <span>估算 {usd.format(summary.estimated_usd_micros / 1e6)}</span>}
            {summary.unconfirmed > 0 && <span>{number.format(summary.unconfirmed)} 笔待核对</span>}
          </> : <span>读取中…</span>}
          <ChevronRight size={13} aria-hidden/>
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] w-[min(96vw,36rem)] max-w-none flex-col rounded-2xl p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ReceiptText size={19} className="text-primary"/>API 用量明细</DialogTitle>
          <DialogDescription className="text-left">显示当前工作区启用记录后的请求。token 取自供应商回执，美元估算按请求单价计算，折扣和赠额以账单为准。</DialogDescription>
        </DialogHeader>
        {isError ? <div role="alert" className="text-sm">用量读取失败。<Button size="sm" variant="ghost" onClick={()=>void refetch()}>重试</Button></div>
          : !data ? <p role="status" className="text-sm text-muted-foreground">正在读取用量…</p> : <>
          <div className="flex flex-wrap items-baseline gap-x-3 rounded-xl bg-muted px-4 py-3 text-xs text-muted-foreground">
            <span className="text-lg font-semibold tabular-nums text-foreground">{number.format(data.summary.tokens)} token</span>
            <span>已回报 · 共 {number.format(data.summary.requests)} 次请求</span>
            {data.summary.estimated_usd_micros > 0 && <span>另计估算 {usd.format(data.summary.estimated_usd_micros / 1e6)}</span>}
            {data.summary.unconfirmed > 0 && <span>其中 {number.format(data.summary.unconfirmed)} 笔待核对</span>}
          </div>
          {data.items.length ? <ul key={before} aria-label="请求明细" className="vp-scroll min-h-0 overflow-y-auto">{data.items.map(item=><Receipt key={item.id} item={item}/>)}</ul>
            : <p className="py-5 text-center text-sm text-muted-foreground">还没有 API 请求记录</p>}
          {(pages.length > 1 || data.next !== null) && <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" disabled={pages.length===1} onClick={()=>setPages(p=>p.slice(0,-1))}>上一页</Button>
            <span className="text-xs text-muted-foreground">第 {pages.length} 页</span>
            <Button variant="ghost" size="sm" disabled={data.next===null} onClick={()=>{if (data.next!==null) setPages(p=>[...p,data.next]);}}>下一页</Button>
          </div>}
        </>}
      </DialogContent>
    </Dialog>
  </footer>;
}

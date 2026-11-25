import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Circle, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLibrary } from "./use-library";
import { api } from "./api";
import { ThemeToggle } from "../workspace/components/ThemeToggle";

type Mark = {label:string; quote:string; hit:boolean; evidence:string; feedback:string};
type Exercise = {id:string; question:string; revision:number; doc:string; name:string; firstLine:number; lastLine:number;
  answer?:string; feedback?:{score:number; marks:Mark[]; followup:string}};
type Reply = {exercise?:Exercise};

function Practice({doc}: {doc:string}) {
  const [exercise,setExercise] = useState<Exercise>();
  const [draft,setDraft] = useState("");
  const [busy,setBusy] = useState(true);
  const [error,setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<Reply>("/interview/current"+(doc?"?"+new URLSearchParams({documentId:doc}):""),{signal:controller.signal})
      .then(result=>setExercise(result.exercise)).catch(e=>{if (!controller.signal.aborted) setError(e.message);})
      .finally(()=>{if (!controller.signal.aborted) setBusy(false);});
    return ()=>controller.abort();
  },[doc]);

  async function submit(action: "next" | "answer") {
    if (busy) return;
    setBusy(true); setError("");
    const next = action === "next";
    try {
      const path = next ? "/interview/next" : "/interview/"+exercise!.id+"/answer";
      const body = next ? {documentId:doc || null,previousId:exercise?.id} :
        {revision:exercise!.revision,answer:draft,supplement:!!exercise?.feedback};
      const result = await api<Reply>(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      setExercise(result.exercise); setDraft("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const feedback = exercise?.feedback;
  const needsAnswer = !feedback || feedback.score < feedback.marks.length;
  function grade(event: FormEvent) {event.preventDefault(); if (draft.trim()) void submit("answer");}
  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">{error}</p>}
    {exercise && <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
      <p className="text-xs text-muted-foreground">{exercise.name}</p>
      <h2 className="text-xl font-semibold">{exercise.question}</h2>
      {feedback && <>
        <p className="font-medium">采分点命中 {feedback.score} / {feedback.marks.length}</p>
        <ol className="space-y-4">{feedback.marks.map((mark,i)=><li key={i} className="space-y-1 text-sm">
          <div className="flex items-start gap-2">{mark.hit?<Check size={16} aria-label="命中" className="text-primary"/>:<Circle size={16} aria-label="遗漏"/>}<strong>{mark.label}</strong></div>
          <p>{mark.feedback}</p>
          {mark.hit && <p className="text-muted-foreground">你的表述 · {mark.evidence}</p>}
          <blockquote className="border-l-2 pl-3 text-muted-foreground">{mark.quote}</blockquote>
        </li>)}</ol>
        <Link className="inline-block text-sm text-primary underline" to={"/library?doc="+encodeURIComponent(exercise.doc)+"#line="+(exercise.firstLine-1)+","+exercise.lastLine}>
          回看笔记 · 第 {exercise.firstLine}–{exercise.lastLine} 行
        </Link>
        <details><summary className="cursor-pointer text-sm text-muted-foreground">我的完整回答</summary>
          <p className="mt-2 whitespace-pre-wrap text-sm">{exercise.answer}</p></details>
      </>}
      {needsAnswer && <form onSubmit={grade} className="space-y-3">
        <label htmlFor="interview-answer" className="block text-sm font-medium">{feedback?.followup || "你的回答"}</label>
        <Textarea id="interview-answer" maxLength={6000} rows={4} value={draft} disabled={busy}
          placeholder={feedback?"补充上一轮遗漏的要点…":"先不看笔记，用自己的话回答…"} onChange={e=>setDraft(e.target.value)}/>
        <Button type="submit" disabled={busy || !draft.trim()}>{feedback?"提交补答":"提交回答"}</Button>
      </form>}
    </section>}
    <div className="flex items-center gap-3">
      <Button variant={exercise?"outline":"default"} disabled={busy} onClick={()=>void submit("next")}>{exercise?"下一题":"开始面试"}</Button>
      {busy && <span role="status" className="text-sm text-muted-foreground">正在处理…</span>}
    </div>
  </div>;
}

export default function Interview() {
  const [params,setParams]=useSearchParams();
  const doc=params.get("doc") || "";
  const {data}=useLibrary();
  return <main className="flex h-full min-h-0 flex-col">
    <header className="app-toolbar flex h-14 shrink-0 items-center justify-between border-b pl-14 pr-4"><span className="text-sm">知识库面试</span><ThemeToggle/></header>
    <div className="vp-scroll min-h-0 flex-1 overflow-y-auto px-5 py-7">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-2"><GraduationCap size={24} className="text-primary"/><h1 className="text-3xl font-semibold">知识库面试</h1>
          <p className="text-sm text-muted-foreground">用自己的笔记做开放题，逐项核对回答，补答遗漏的采分点。</p></header>
        <label className="flex items-center gap-3 text-sm">出题范围
          <select className="min-w-0 max-w-[70%] rounded-md border bg-background px-3 py-2" value={doc}
            onChange={e=>setParams(e.target.value?{doc:e.target.value}:{})}>
            <option value="">全部文档</option>{data?.documents.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
        <Practice key={doc} doc={doc}/>
      </div>
    </div>
  </main>;
}

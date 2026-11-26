import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, BookOpen, Check, ChevronRight, CircleCheck, FileText, Layers, ListChecks, MessageCircle, PencilLine, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "../workspace/components/ThemeToggle";
import { api } from "./api";
import { StudyCover } from "./StudyCover";
import { useLibrary } from "./use-library";
import "./interview.css";

type Mark = {label: string; quote: string; hit: boolean; evidence: string; feedback: string};
type Feedback = {score: number; marks: Mark[]; followup: string};
type Exercise = {
  id: string; question: string; revision: number; doc: string; name: string;
  firstLine: number; lastLine: number; answer?: string; feedback?: Feedback;
};
type Reply = {exercise?: Exercise};
type Action = "next" | "answer";
const stages = [
  {label: "选择材料", icon: Layers},
  {label: "独立作答", icon: PencilLine},
  {label: "逐点复盘", icon: ListChecks},
];

function Scorecard({exercise, feedback}: {exercise: Exercise; feedback: Feedback}) {
  return <section className="interview-card interview-score" aria-labelledby="interview-score">
    <div className="interview-score-header">
      <h2 id="interview-score" tabIndex={-1}>采分点命中 <span>{feedback.score} / {feedback.marks.length}</span></h2>
      <div className="score-segments" aria-hidden="true">{feedback.marks.map((mark, i) =>
        <i key={i} data-hit={mark.hit}/>)}</div>
    </div>
    <ol className="score-list">{feedback.marks.map((mark, i) => <li key={i} data-hit={mark.hit}>
      <div className="score-point"><strong>{mark.label}</strong><span>{mark.hit ? <Check size={13}/> : <RotateCcw size={12}/>}
        {mark.hit ? "命中" : "遗漏"}</span></div>
      <p>{mark.feedback}</p>
      {mark.hit && <p className="score-evidence">你的表述 · {mark.evidence}</p>}
      <blockquote>{mark.quote}</blockquote>
    </li>)}</ol>
    <Link className="interview-citation" to={"/library?doc="+encodeURIComponent(exercise.doc)+"#line="+(exercise.firstLine-1)+","+exercise.lastLine}>
      <BookOpen size={15}/>回看笔记 · 第 {exercise.firstLine}–{exercise.lastLine} 行<ChevronRight size={14}/>
    </Link>
  </section>;
}

function Practice({doc, selectDoc}: {doc: string; selectDoc: (id: string) => void}) {
  const library = useLibrary();
  const documents = library.data?.documents ?? [];
  const empty = library.isSuccess && documents.length === 0;
  const [exercise, setExercise] = useState<Exercise>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<Action | "load" | null>("load");
  const [error, setError] = useState("");
  const focusAfterSubmit = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<Reply>("/interview/current" + (doc ? "?" + new URLSearchParams({documentId: doc}) : ""), {signal: controller.signal})
      .then(result => setExercise(result.exercise))
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => controller.abort();
  }, [doc]);

  useEffect(() => {
    if (focusAfterSubmit.current) {
      document.getElementById(focusAfterSubmit.current)?.focus();
      focusAfterSubmit.current = null;
    }
  }, [exercise]);

  async function submit(action: Action) {
    if (busy || (action === "answer" && (!exercise || !draft.trim()))) return;
    setBusy(action);
    setError("");
    try {
      const next = action === "next";
      const path = next ? "/interview/next" : "/interview/" + exercise!.id + "/answer";
      const body = next ? {documentId: doc || null, previousId: exercise?.id} :
        {revision: exercise!.revision, answer: draft, supplement: !!exercise?.feedback};
      const result = await api<Reply>(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
      focusAfterSubmit.current = next ? "interview-question" : "interview-score";
      setExercise(result.exercise);
      setDraft("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  const feedback = exercise?.feedback;
  const stage = feedback ? 2 : exercise ? 1 : 0;
  const needsAnswer = !feedback || feedback.score < feedback.marks.length;
  function grade(event: FormEvent) {
    event.preventDefault();
    void submit("answer");
  }
  const documentSelect = <select id="interview-scope" aria-label="出题范围" value={doc} disabled={!!busy}
    onChange={event => selectDoc(event.target.value)}>
    <option value="">全部文档</option>
    {documents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
  </select>;

  const controls = <>
    {needsAnswer && <form onSubmit={grade} className="interview-response">
      <label htmlFor="interview-answer"><MessageCircle size={16}/>{feedback?.followup || "你的回答"}</label>
      <Textarea id="interview-answer" maxLength={6000} rows={5} value={draft} disabled={!!busy}
        placeholder={feedback ? "补充上一轮遗漏的要点…" : "先不看笔记，用自己的话回答…"} onChange={e => setDraft(e.target.value)}/>
      <div className="interview-submit"><small>{draft.length} / 6000</small>
        <Button type="submit" disabled={!!busy || !draft.trim()}>{feedback ? "提交补答" : "提交回答"}<ArrowRight/></Button></div>
    </form>}
    <div className="interview-next"><Button variant={needsAnswer ? "outline" : "default"} disabled={!!busy}
      onClick={() => void submit("next")}>下一题<ArrowRight/></Button></div>
  </>;

  return <div className="interview-content">
    <StudyCover subject="interview" compact={!!exercise} title="知识库面试">
      用自己的笔记练习面试。先独立回答，再对照原文补齐遗漏的采分点。
    </StudyCover>
    <ol aria-label="面试进度" className="interview-stages">{stages.map(({label, icon: Icon}, i) =>
      <li key={label} aria-current={stage === i ? "step" : undefined} data-past={stage > i}>
        {stage > i ? <CircleCheck size={17}/> : <Icon size={17}/>}<span>{label}</span>
      </li>)}</ol>
    {error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">{error}</p>}
    {library.isError && <button className="text-sm text-primary underline" onClick={() => void library.refetch()}>资料库读取失败，重试</button>}
    {!exercise ? <section className="interview-card interview-prep" aria-labelledby="interview-materials">
      <div className="interview-card-heading"><h2 id="interview-materials">面试材料</h2>
        {library.isSuccess && <span>{documents.length} 篇笔记</span>}</div>
      {empty ? <div className="interview-empty">
        <span className="interview-doc-icon"><FileText size={21}/></span>
        <div><strong>还没有面试笔记</strong><p>上传 Markdown 或粘贴笔记原文，即可从中出题。</p></div>
        <Button asChild><Link to="/library">导入文档<ArrowRight/></Link></Button>
      </div> : <div className="interview-setup">
        <div><label htmlFor="interview-scope">出题范围</label>{documentSelect}</div>
        <Button disabled={!!busy} onClick={() => void submit("next")}>开始面试<ArrowRight/></Button>
      </div>}
    </section> : <>
      <div className="interview-scope-bar"><label htmlFor="interview-scope"><Layers size={15}/>出题范围</label>{documentSelect}</div>
      <div className="interview-round" data-graded={!!feedback}>
        <section className="interview-card interview-question" aria-labelledby="interview-question">
          <p className="interview-source"><FileText size={15}/>{exercise.name}</p>
          <h2 id="interview-question" tabIndex={-1}>{exercise.question}</h2>
          {feedback && <details className="interview-answer-history"><summary>我的完整回答</summary>
            <p>{exercise.answer}</p></details>}
          {!feedback && controls}
        </section>
        {feedback && <>
          <Scorecard exercise={exercise} feedback={feedback}/>
          <div className="interview-card interview-controls">{controls}</div>
        </>}
      </div>
    </>}
    <p role="status" className="text-sm text-muted-foreground">{busy === "load" ? "正在读取面试进度…" :
      busy === "next" ? "正在从笔记中出题…" : busy === "answer" ? "正在逐项核对回答…" : ""}</p>
  </div>;
}

export default function Interview() {
  const [params, setParams] = useSearchParams();
  const doc = params.get("doc") || "";
  return <main className="interview-page flex h-full min-h-0 flex-col">
    <header className="app-toolbar flex h-14 shrink-0 items-center justify-between border-b pl-14 pr-4">
      <div className="flex items-center gap-2 text-sm"><span className="toolbar-crumb">工作空间</span><ChevronRight size={13} className="toolbar-crumb" aria-hidden/>面试练习</div>
      <ThemeToggle/>
    </header>
    <div className="vp-scroll min-h-0 flex-1 overflow-y-auto">
      <Practice key={doc} doc={doc} selectDoc={id => setParams(id ? {doc: id} : {})}/>
    </div>
  </main>;
}

<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted } from "vue";
import { getClientId } from "@/lib/api";
type Evidence = {video_id: string; start: number; quote: string};
type Question = {id: string; qtype: string; stem: string; options?: string[]};
type Grade = {correct: boolean; answer: string; explanation: string; evidence: Evidence[]};
type Item = {id:string; topic:string; video_id:string; start:number; minutes:number; reason:string};
type Day = {date:string; items:Item[]};
type Section = {title:string; minutes:number; points:{text:string; evidence:Evidence}[]};
const props=defineProps<{base:string;video:string;view:string;jump:(n:number)=>void}>();
const busy=ref(false), notice=ref(""), topic=ref(""), minutes=ref(45), instruction=ref("");
const quizId=ref(""), questions=ref<Question[]>([]), answers=ref<Record<string,string>>({}), grades=ref<Record<string,Grade>>({});
const course=ref(""), days=ref<Day[]>([]), overflow=ref<Item[]>([]), checked=ref<Record<string,boolean>>({});
const planId=ref(""), sections=ref<Section[]>([]), version=ref(0);
const abort=new AbortController();
const storeKey=(name:string)=>"vp:"+props.base+":"+props.video+":"+getClientId()+":"+name;
function remember(key:string,value:string){try{localStorage.setItem(storeKey(key),value)}catch{/* unavailable */}}
function recall(key:string){try{return localStorage.getItem(storeKey(key))||""}catch{return ""}}
async function api(path:string,body?:unknown) {
  const res=await fetch(props.base+path, {method:body===undefined?"GET":"POST",signal:abort.signal,
    headers:body===undefined?{}:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await res.json();
  if(!res.ok || !data.success) throw new Error(data.error || "请求失败");
  return data;
}
async function act(fn:()=>Promise<void>) {
  if(busy.value)return;
  busy.value=true;notice.value="";
  try {await fn();} catch(e){if(!abort.signal.aborted) notice.value=e instanceof Error?e.message:"请求失败";}
  finally {busy.value=false;}
}
async function ensureCourse(){
  if(!course.value) course.value=(await api("/v2/videos/"+encodeURIComponent(props.video)+"/course",{})).course_id;
  return course.value;
}
async function generate(){
  const data=await api("/quiz/generate",{video_id:props.video,topic:topic.value,count:3});
  if(!data.questions?.length){notice.value=data.reason||"当前视频没有可核验的题目"; return;}
  quizId.value=data.quiz_id;questions.value=data.questions;grades.value={};answers.value={};
  remember("quiz",quizId.value);
}
async function grade(id:string) {
  grades.value[id]=await api("/quiz/"+quizId.value+"/answer",{question_id:id,answer:answers.value[id]});
}
async function review(){
  const data=await api("/review/plan",{course_id:await ensureCourse(),daily_minutes:minutes.value,use_llm:false});
  days.value=data.plan.days;overflow.value=data.plan.overflow;checked.value={};
}
async function mark(item:Item){
  const done=!checked.value[item.id];
  await api("/review/done",{course_id:await ensureCourse(),item_id:item.id,done});
  checked.value[item.id]=done;
}
function showPlan(data:{plan_id:string;sections:Section[];version:number}){
  planId.value=data.plan_id;sections.value=data.sections;version.value=data.version;remember("teach",planId.value);
}
async function teach(revise:boolean){
  const data=revise?await api("/teach/plan/"+planId.value+"/revise",{instruction:instruction.value,minutes:minutes.value}):
    await api("/teach/plan",{course_id:await ensureCourse(),topic:topic.value,minutes:minutes.value,homework_count:0});
  showPlan(data.plan);instruction.value="";
}
onMounted(()=>{void act(async()=>{
  if(props.view==="quiz" && recall("quiz")){
    const data=await api("/quiz/"+encodeURIComponent(recall("quiz")));quizId.value=data.quiz.id;questions.value=data.quiz.questions;
  } else if(props.view==="teach" && recall("teach")){
    const data=await api("/teach/plan/"+encodeURIComponent(recall("teach")));showPlan({...data.plan,plan_id:data.id,version:data.version});
  }
})});
onBeforeUnmount(()=>abort.abort());
</script>

<template>
  <section class="study">
    <template v-if="view==='quiz'">
      <h2>视频自测</h2>
      <form @submit.prevent="act(generate)"><input v-model="topic" placeholder="知识点（可选）" aria-label="测验知识点"><button :disabled="busy">生成三道题</button></form>
      <article v-for="(q,i) in questions" :key="q.id">
        <h3>{{ i+1 }}. {{ q.stem }}</h3>
        <select v-if="q.qtype==='single' && q.options?.length" v-model="answers[q.id]" :aria-label="q.stem">
          <option v-for="(o,n) in q.options" :key="n" :value="String.fromCharCode(65+n)">{{ String.fromCharCode(65+n) }}. {{ o }}</option>
        </select>
        <input v-else v-model="answers[q.id]" :aria-label="q.stem" placeholder="你的答案">
        <button :disabled="busy || !answers[q.id]" @click="act(()=>grade(q.id))">提交答案</button>
        <div v-if="grades[q.id]"><p>{{ grades[q.id].correct?'答对了':'参考答案：'+grades[q.id].answer }} · {{ grades[q.id].explanation }}</p>
          <button v-for="ev in grades[q.id].evidence" :key="ev.quote" @click="props.jump(ev.start)">回看 · {{ ev.quote }}</button></div>
      </article>
    </template>
    <template v-else-if="view==='review'">
      <h2>课程复习计划</h2>
      <form @submit.prevent="act(review)"><label>每天 <input type="number" min="1" max="480" required v-model.number="minutes"> 分钟</label><button :disabled="busy">查看我的安排</button></form>
      <article v-for="day in days.filter(d=>d.items.length)" :key="day.date"><h3>{{ day.date }}</h3>
        <div v-for="item in day.items" :key="item.id"><p>{{ item.topic }} · {{ item.minutes }} 分钟</p><p>{{ item.reason }}</p>
          <button v-if="item.video_id===video" @click="props.jump(item.start)">回看片段</button>
          <button :disabled="busy" @click="act(()=>mark(item))">{{ checked[item.id]?'撤销完成':'标记完成' }}</button></div>
      </article>
      <p v-if="overflow.length">待安排：{{ overflow.map(x=>x.topic).join('、') }}</p>
    </template>
    <template v-else>
      <h2>按课程证据备课</h2>
      <form @submit.prevent="act(()=>teach(false))"><input v-model="topic" required placeholder="授课主题" aria-label="授课主题">
        <label><input type="number" min="1" max="480" required v-model.number="minutes"> 分钟</label><button :disabled="busy">生成备课方案</button></form>
      <p v-if="planId">版本 {{ version }}</p>
      <article v-for="(section,i) in sections" :key="i"><h3>{{ section.title }} · {{ section.minutes }} 分钟</h3>
        <div v-for="(point,n) in section.points" :key="n"><p>{{ point.text }}</p>
          <button v-if="point.evidence.video_id===video" @click="props.jump(point.evidence.start)">回看 · {{ point.evidence.quote }}</button>
          <p v-else>{{ point.evidence.quote }}</p></div>
      </article>
      <form v-if="planId" @submit.prevent="act(()=>teach(true))"><input v-model="instruction" required placeholder="本次修改要求" aria-label="修改要求"><button :disabled="busy">另存新版本</button></form>
    </template>
    <p role="status">{{ busy?'处理中…':notice }}</p>
  </section>
</template>

<style scoped>
.study { max-width:48rem; margin:auto; font-size:.85rem; }
h2 { font-size:1rem; font-weight:600; margin-bottom:1rem; }
h3 { font-weight:600; margin-bottom:.4rem; }
form { display:flex; align-items:center; flex-wrap:wrap; gap:.65rem; }
input,select,button { border:1px solid hsl(var(--border)); background:hsl(var(--background)); padding:.4rem .65rem; border-radius:.45rem; }
input[type=number]{width:5rem;}
button {cursor:pointer; color:hsl(var(--primary));} button:disabled {opacity:.55;}
article {border-top:1px solid hsl(var(--border)); margin-top:1rem; padding-top:1rem;}
article p {margin:.4rem 0;white-space:pre-wrap;} article button {margin-right:.3rem;margin-top:.3rem;}
</style>

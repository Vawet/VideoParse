<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";

type Hit = { id: number; source: string; start: number; text: string; frame: string };
type Claim = { answer: string; quote: string; evidence: Hit };
const props = defineProps<{ base: string; video: string; jump: (time: number) => void }>();
const query = ref(""), searched = ref(""), error = ref(""), message = ref("");
const hits = ref<Hit[]>([]), claims = ref<Claim[]>([]);
const busy = ref(false), canAsk = ref(false);
let request: AbortController | undefined;
onBeforeUnmount(() => request?.abort());

async function run(ask = false) {
  const q = query.value.trim();
  if (!q || busy.value) return;
  request = new AbortController();
  busy.value = true; error.value = ""; message.value = ""; claims.value = [];
  if (!ask) { hits.value = []; canAsk.value = false; }
  try {
    const root = props.base + "/v2/videos/" + encodeURIComponent(props.video);
    const response = await fetch(ask ? root + "/ask" : root + "/evidence?q=" + encodeURIComponent(q),
      ask ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }), signal: request.signal }
          : { signal: request.signal });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "获取证据失败");
    if (ask) { claims.value = data.claims; message.value = data.message; }
    else { hits.value = data.hits; canAsk.value = data.can_ask; searched.value = q;
      if (!hits.value.length) message.value = "未找到匹配的字幕或画面文字。"; }
  } catch (caught) {
    if (!request.signal.aborted) error.value = caught instanceof Error ? caught.message : "请求失败";
  } finally { busy.value = false; }
}
const clock = (seconds: number) => [Math.floor(seconds / 60), Math.floor(seconds % 60).toString().padStart(2, "0")].join(":");
const sourceName = (s: string) => s === "ocr" ? "画面文字" : s === "frame_note" ? "画面笔记" : "语音字幕";
</script>

<template>
  <details class="evidence">
    <summary>查找字幕与画面证据</summary>
    <form @submit.prevent="run()">
      <input v-model="query" aria-label="证据关键词或问题" maxlength="1000" placeholder="例如：画面里的损失函数" />
      <button :disabled="busy || !query.trim()">检索</button>
    </form>
    <div aria-live="polite" class="records">
      <p v-if="busy">正在查找依据…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="message">{{ message }}</p>
      <div v-for="hit in hits" :key="hit.id" class="hit">
        <button type="button" @click="props.jump(hit.start)">{{ clock(hit.start) }} · {{ sourceName(hit.source) }}</button>
        <p>{{ hit.text }}</p>
      </div>
      <button v-if="canAsk && hits.length && searched === query.trim()" type="button" :disabled="busy" @click="run(true)">依据这些片段回答</button>
      <div v-for="(claim, i) in claims" :key="i" class="hit">
        <p>{{ claim.answer }}</p>
        <button type="button" @click="props.jump(claim.evidence.start)">{{ clock(claim.evidence.start) }} · {{ claim.quote }}</button>
      </div>
    </div>
  </details>
</template>

<style scoped>
.evidence { border: 1px solid hsl(var(--border)); border-radius: 1rem; padding: .85rem 1rem; background: hsl(var(--card)); font-size: .8rem; }
summary, button { cursor: pointer; }
summary { color: hsl(var(--foreground)); font-weight: 600; }
form { display: flex; gap: .5rem; margin-top: .6rem; }
input { flex: 1; min-width: 0; color: inherit; background: transparent; border-bottom: 1px solid hsl(var(--border)); }
button { color: hsl(var(--primary)); text-align: left; }
form button { background: hsl(var(--primary-soft)); padding: .35rem .75rem; border-radius: .7rem; }
button:disabled { opacity: .6; }
.records { overflow: auto; max-height: min(33vh, 20rem); }
.hit { margin-top: .65rem; }
.hit p { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>

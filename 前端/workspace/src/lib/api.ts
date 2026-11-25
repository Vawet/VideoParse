import { resumableUpload } from "./resumable-upload";

const platform = import.meta.env.VITE_PLATFORM === "true";

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ??
  "http://127.0.0.1:5000";

let workspaceId = "";
let sessionRequest: Promise<void> | undefined;
const transientWorkspace = Math.random().toString(36).slice(2);

export function openWorkspace(): Promise<void> {
  if (!platform || workspaceId) return Promise.resolve();
  if (!sessionRequest) {
    const load = async () => {
      const { workspace_id } = await request<{ workspace_id: string }>("/v2/session", {
        cache: "no-store", signal: AbortSignal.timeout(5000),
      });
      workspaceId = workspace_id;
    };
    // Serialize the first Set-Cookie across tabs opened at the same time.
    sessionRequest = (navigator.locks ? navigator.locks.request("vp-session:" + API_BASE, load) : load())
      .then(() => undefined).finally(() => { sessionRequest = undefined; });
  }
  return sessionRequest;
}

const CLIENT_KEY = "videoparse-client-id";

export function getClientId(): string {
  if (platform) return workspaceId || transientWorkspace;
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

type Envelope<T> = { success: boolean; error?: string } & T;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const data = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!data) throw new Error(`后端无响应(${response.status})`);
  if (!data.success) throw new Error(data.error || `请求失败(${response.status})`);
  return data;
}

const postJson = <T>(path: string, body: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** The upload gate: a question that must be answered before a one-time token is issued. */
export async function getUploadGate() {
  await openWorkspace();
  return request<{ required: boolean; question: string }>(platform ? "/v2/gate" : "/upload/question");
}

export async function verifyUploadGate(answer: string) {
  const data = await postJson<{ token: string }>(platform ? "/v2/gate" : "/upload/verify", { answer });
  return data.token;
}

export function uploadVideo(
  file: File,
  token: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<{ filepath: string; video_id: string }> {
  if (platform) return resumableUpload(API_BASE, getClientId(), file, token, onProgress, signal);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/upload`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    xhr.onerror = () => reject(new Error("无法连接后端,请确认后端已启动(端口 5000)"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.success) resolve(data);
        else reject(new Error(data.error || "上传失败"));
      } catch {
        reject(new Error(`上传失败(${xhr.status})`));
      }
    };
    signal?.addEventListener("abort", () => xhr.abort());
    const form = new FormData();
    form.append("video", file);
    form.append("token", token);
    xhr.send(form);
  });
}

export async function startAnalyze(filepath: string, videoId: string) {
  return postJson<{ task_id: string; video_id: string }>("/analyze/start", {
    filepath,
    video_id: videoId,
  });
}

export type AgentEvent =
  | { type: "progress"; stage: "publishing"; text: string; retry_in_seconds?: number }
  | { type: "thought"; step: number; text: string }
  | { type: "tool_start"; step: number; tool: string; args?: unknown }
  | { type: "tool_end"; step: number; tool: string; ok: boolean; observation?: unknown }
  | { type: "error"; text: string }
  | { type: "end"; status: "done" | "error"; error?: string | null };

/** Subscribes to the Agent's event stream. Returns an unsubscribe function. */
export function subscribeTask(taskId: string, onEvent: (event: AgentEvent) => void): () => void {
  const taskUrl = `${API_BASE}/tasks/${encodeURIComponent(taskId)}`;
  let source: EventSource;
  let stopped = false;
  let lastId = 0;
  let received = 0;
  let lastActivity = Date.now();
  let timer: number | undefined;

  function close() {
    stopped = true;
    source.close();
    window.clearInterval(timer);
  }

  function deliver(event: AgentEvent) {
    if (stopped) return;
    if (event.type === "end") close();
    onEvent(event);
  }

  function connect() {
    const stream = new EventSource(taskUrl + "/events");
    source = stream;
    stream.onmessage = (message) => {
      if (stopped || stream !== source) return;
      const id = Number(message.lastEventId);
      if (id > 0 && id <= lastId) return;
      let event: AgentEvent;
      try { event = JSON.parse(message.data) as AgentEvent; }
      catch { return; }
      if (id > 0) lastId = id;
      received++;
      lastActivity = Date.now();
      deliver(event);
    };
    stream.onerror = () => {
      if (platform || stream.readyState === EventSource.CLOSED) return;
      deliver({ type: "end", status: "error", error: "与后端的事件连接中断" });
    };
  }

  // A reverse proxy can leave EventSource OPEN after the worker has disappeared.
  async function reconcile() {
    if (Date.now() - lastActivity < 10000) return;
    try {
      const response = await fetch(taskUrl, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (stopped) return;
      if (response.status === 404) {
        deliver({ type: "end", status: "error", error: "任务不存在" });
        return;
      }
      if (!response.ok) return;
      const task = await response.json();
      if (stopped || !task.success) return;
      if (task.status === "done" || task.status === "error") {
        deliver({ type: "end", status: task.status, error: task.error });
      } else if (source.readyState === EventSource.CLOSED || task.events > received) {
        source.close();
        connect();
      }
    } catch { /* The next check can resume when the platform is reachable. */ }
  }

  connect();
  if (platform) timer = window.setInterval(reconcile, 10000);
  return close;
}

export type RawResult = {
  summary: string;
  highlights: string[];
  segments: {
    notes?: { content?: string };
    image: string;
    time_range: string;
    captions?: string;
  }[];
  division: {
    title: string;
    time_range: { start_time: string; end_time: string };
    summary: string[] | string;
  }[];
  heavys?: unknown[];
  mind_map: {
    mind_map: { data: RawMindNode };
  };
  agent_note?: string;
};

export type RawMindNode = { id?: string; name?: string; children?: RawMindNode[] };

export async function fetchResult(videoId: string) {
  const data = await request<{ result: RawResult }>(`/result/${encodeURIComponent(videoId)}`);
  return data.result;
}

export type LibraryVideo = { id: string; name: string; duration: number };
export type LibraryDocument = { id: string; name: string; chunks: number; indexedChunks: number; indexState: string };
export type LibraryFolder = { id: "videos" | "documents"; name: string };
export type ArchivedVideo = { video: LibraryVideo; filepath: string; result: RawResult };

export async function fetchLibrary() {
  await openWorkspace();
  return request<{ folders: LibraryFolder[]; videos: LibraryVideo[]; documents: LibraryDocument[] }>("/v2/library");
}

export async function fetchArchivedVideo(id: string, signal: AbortSignal) {
  await openWorkspace();
  return request<ArchivedVideo>("/v2/library/videos/" + encodeURIComponent(id), {signal});
}

export type RawCitation = { time: string; seconds: number; valid: boolean; text: string };

export type WebSource = { title: string; url: string; snippet: string };
export type ChatReply = { answer: string; source?: "video" | "course" | "web"; web_sources?: WebSource[];
  history: unknown[]; conversation_id?: string; citations: RawCitation[] };

export async function askDemo(question: string) {
  await openWorkspace();
  return postJson<ChatReply | { source: "demo" }>("/v2/demo/ask", { question });
}

export async function askVideo(
  videoId: string,
  question: string,
  history: unknown[],
  conversationId?: string,
) {
  return postJson<ChatReply>("/chat", {
    video_id: videoId,
    question,
    ...(platform ? { conversation_id: conversationId } : { history, client_id: getClientId() }),
  });
}

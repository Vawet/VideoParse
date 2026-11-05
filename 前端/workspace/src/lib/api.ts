/** Thin client for the VideoParse Flask backend (see 后端/app/main.py). */

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ??
  "http://127.0.0.1:5000";

const CLIENT_KEY = "videoparse-client-id";

export function getClientId(): string {
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
  return request<{ required: boolean; question: string }>("/upload/question");
}

export async function verifyUploadGate(answer: string) {
  const data = await postJson<{ token: string }>("/upload/verify", { answer });
  return data.token;
}

export function uploadVideo(
  file: File,
  token: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<{ filepath: string; video_id: string }> {
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
  | { type: "thought"; step: number; text: string }
  | { type: "tool_start"; step: number; tool: string; args?: unknown }
  | { type: "tool_end"; step: number; tool: string; ok: boolean; observation?: unknown }
  | { type: "error"; text: string }
  | { type: "end"; status: "done" | "error"; error?: string | null };

/** Subscribes to the Agent's event stream. Returns an unsubscribe function. */
export function subscribeTask(taskId: string, onEvent: (event: AgentEvent) => void): () => void {
  const source = new EventSource(`${API_BASE}/tasks/${taskId}/events`);
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as AgentEvent;
      onEvent(event);
      if (event.type === "end") source.close();
    } catch {
      /* keep-alive or malformed frame */
    }
  };
  source.onerror = () => {
    // EventSource would retry forever; a closed stream means the task is gone.
    if (source.readyState === EventSource.CLOSED) return;
    source.close();
    onEvent({ type: "end", status: "error", error: "与后端的事件连接中断" });
  };
  return () => source.close();
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

export type RawCitation = { time: string; seconds: number; valid: boolean; text: string };

export async function askVideo(
  videoId: string,
  question: string,
  history: unknown[],
) {
  return postJson<{ answer: string; history: unknown[]; citations: RawCitation[] }>("/chat", {
    video_id: videoId,
    question,
    history,
    client_id: getClientId(),
  });
}

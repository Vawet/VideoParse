const CHUNK = 5 * 1024 * 1024;

async function digest(data: ArrayBuffer) {
  if (!crypto.subtle) throw new Error("分片校验需要 HTTPS 或 localhost，请使用安全地址打开工作台");
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function resumableUpload(base: string, workspace: string, file: File, token: string,
  progress: (percent: number) => void, signal?: AbortSignal): Promise<{ filepath: string; video_id: string }> {
  const hashes: string[] = [];
  for (let pos = 0; pos < file.size; pos += CHUNK) {
    signal?.throwIfAborted();
    hashes.push(await digest(await file.slice(pos, pos + CHUNK).arrayBuffer()));
  }
  const fingerprint = await digest(new TextEncoder().encode(JSON.stringify([file.name, file.size, hashes])).buffer);
  const key = `videoparse-upload:${base}:${workspace}:${fingerprint}`;
  async function request(path: string, options: RequestInit, missingOK = false) {
    const response = await fetch(`${base}/v2/uploads${path}`, { ...options, signal });
    if (missingOK && response.status === 404) return null;
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.error || `上传失败 (${response.status})`);
    return body;
  }
  let id: string | null = null;
  try { id = localStorage.getItem(key); } catch { /* Storage may be unavailable. */ }
  const saved = id ? await request(`/${id}`, {}, true) : null;
  if (!saved) {
    const session = await request("", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, bytes: file.size, hashes, token }) });
    id = session.id;
    try { localStorage.setItem(key, id!); } catch { /* Current upload can still finish. */ }
  }
  const existing = new Set<number>(saved?.parts || []);
  let sent = [...existing].reduce((sum, i) => sum + Math.min(CHUNK, file.size - i * CHUNK), 0);
  for (let i = 0; i < hashes.length; i++) {
    if (!existing.has(i)) {
      const chunk = file.slice(i * CHUNK, (i + 1) * CHUNK);
      await request(`/${id}/${i}`, { method: "PUT", body: chunk });
      sent += chunk.size;
    }
    progress(Math.floor(99 * sent / file.size));
  }
  const result = await request(`/${id}/complete`, { method: "POST" });
  try { localStorage.removeItem(key); } catch { /* No resumable record in this browser. */ }
  return result;
}

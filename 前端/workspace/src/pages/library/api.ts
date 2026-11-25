import { API_BASE, openWorkspace } from "@/lib/api";

export async function api<T>(path = "", options?: RequestInit): Promise<T> {
  await openWorkspace();
  const res = await fetch(API_BASE + "/v2/documents" + path, options);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "请求未完成");
  return data;
}

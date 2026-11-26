import { API_BASE, openWorkspace, type LibraryDocument } from "@/lib/api";

export function api<T>(path = "", options?: RequestInit) {
  return libraryRequest<T>("/documents" + path, options);
}

export function libraryApi<T>(path: string, options?: RequestInit) {
  return libraryRequest<T>("/library" + path, options);
}

async function libraryRequest<T>(path: string, options?: RequestInit): Promise<T> {
  await openWorkspace();
  const res = await fetch(API_BASE + "/v2" + path, options);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "请求未完成");
  return data;
}

export async function uploadDocument(file: File): Promise<LibraryDocument> {
  const form = new FormData();
  form.set("file", file);
  const {document} = await api<{document: LibraryDocument}>("", {method: "POST", body: form});
  return document;
}

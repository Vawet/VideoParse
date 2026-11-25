import { API_BASE } from "./api";
export type RecentTask = { videoId: string; filepath: string; name: string; taskId: string };
const key = "vp:recent-tasks:" + API_BASE;
export function recentTasks(): RecentTask[] {
  try {
    const items: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(items)) return [];
    return items.filter((r): r is RecentTask => r && typeof r.name === "string" &&
      /^[\w-]{1,64}$/.test(r.videoId) && /^[\w-]+\.[a-z0-9]+$/i.test(r.filepath) &&
      r.filepath.split(".")[0] === r.videoId && /^[a-f0-9]{32}$/.test(r.taskId)).slice(0, 15);
  } catch { return []; }
}
export function rememberTask(row: RecentTask) {
  const rows = [row, ...recentTasks().filter((r) => r.videoId !== row.videoId)].slice(0, 15);
  try { localStorage.setItem(key, JSON.stringify(rows)); } catch { /* Session can still run. */ }
  return rows;
}

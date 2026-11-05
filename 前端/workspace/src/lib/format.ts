/** Shared formatting helpers for the VideoParse workspace. */

/** `mm:ss`, or `h:mm:ss` once the media passes one hour. */
export function formatTime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** `1.2 GB`, `364 MB`, `980 KB` — for the upload card. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Percentage of `total` that `value` represents, rounded and clamped to 0–100. */
export function toPercent(value: number, total: number): number {
  if (total <= 0) return 0;
  return clamp(Math.round((value / total) * 100), 0, 100);
}

/** Minutes as a readable study interval: `1 天`, `3 天`, `10 分钟`. */
export function formatInterval(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时`;
  return `${Math.round(minutes / (60 * 24))} 天`;
}

// 触发全局火花特效（由 FxLayer 注册）。n 越大越"盛大"，用于答对撒彩带
export const burstAt = (x, y, n = 1) => { if (window.__vpBurst) window.__vpBurst(x, y, n); };
export const burstFromEl = (el, n = 1) => {
  if (!el) return;
  const r = el.getBoundingClientRect();
  burstAt(r.left + r.width / 2, r.top + r.height / 2, n);
};

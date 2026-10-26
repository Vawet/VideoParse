import React, { useEffect, useRef } from 'react';

// 全局特效层（挂在应用根部，只挂一次）：
//  1. 粒子网络：粒子互相连线，鼠标靠近会被吸引并连线
//  2. 极光光球 + 透视网格 + 噪点（纯 CSS）
//  3. 光标聚光灯：跟随鼠标的柔光
//  4. 点击火花：点按钮/卡片/链接时迸发彩色粒子
//  5. 卡片 3D 倾斜 + 高光跟随（事件委托到 .file-card）
const COLORS = ['#22d3ee', '#8b5cf6', '#f472b6', '#a3e635', '#60a5fa'];

const FxLayer = () => {
  const bgRef = useRef(null);
  const sparkRef = useRef(null);
  const spotRef = useRef(null);

  useEffect(() => {
    document.body.classList.add('vp');
    document.documentElement.setAttribute('data-color-mode', 'dark'); // 让 MDEditor 使用暗色
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const bg = bgRef.current;
    const sp = sparkRef.current;
    const bctx = bg.getContext('2d');
    const sctx = sp.getContext('2d');
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const mouse = { x: -9999, y: -9999, sx: window.innerWidth / 2, sy: window.innerHeight / 2 };
    let particles = [];
    const sparks = [];
    let raf;

    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      [bg, sp].forEach((c) => { c.width = w * dpr; c.height = h * dpr; });
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(95, Math.floor((w * h) / 16000));
      particles = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.45, vy: (Math.random() - 0.5) * 0.45,
        r: Math.random() * 1.8 + 0.6, c: COLORS[(Math.random() * COLORS.length) | 0],
        ph: Math.random() * Math.PI * 2,
      }));
    };
    resize();

    const burst = (x, y) => {
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = Math.random() * 5 + 1.5;
        sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.2, life: 1, r: Math.random() * 2.6 + 0.8,
          c: COLORS[(Math.random() * COLORS.length) | 0] });
      }
      sparks.push({ x, y, ring: true, life: 1, r: 4, c: '#67e8f9' });
    };

    window.__vpBurst = (x, y, n = 1) => { for (let i = 0; i < n; i++) burst(x, y); };

    const frame = (t) => {
      bctx.clearRect(0, 0, w, h);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        // 鼠标吸引
        const dx = mouse.x - p.x, dy = mouse.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 < 22000) { p.vx += dx * 0.000035; p.vy += dy * 0.000035; }
        p.vx *= 0.995; p.vy *= 0.995;
        p.x += p.vx; p.y += p.vy;
        if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
        const glow = 0.55 + Math.sin(t / 700 + p.ph) * 0.35;
        bctx.globalAlpha = glow;
        bctx.fillStyle = p.c;
        bctx.shadowColor = p.c; bctx.shadowBlur = 10;
        bctx.beginPath(); bctx.arc(p.x, p.y, p.r, 0, 6.283); bctx.fill();
        bctx.shadowBlur = 0;
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const ex = p.x - q.x, ey = p.y - q.y, d = ex * ex + ey * ey;
          if (d < 14000) {
            bctx.globalAlpha = (1 - d / 14000) * 0.28;
            bctx.strokeStyle = p.c; bctx.lineWidth = 0.8;
            bctx.beginPath(); bctx.moveTo(p.x, p.y); bctx.lineTo(q.x, q.y); bctx.stroke();
          }
        }
        if (d2 < 30000) { // 与鼠标连线
          bctx.globalAlpha = (1 - d2 / 30000) * 0.6;
          bctx.strokeStyle = '#67e8f9'; bctx.lineWidth = 1;
          bctx.beginPath(); bctx.moveTo(p.x, p.y); bctx.lineTo(mouse.x, mouse.y); bctx.stroke();
        }
      }
      bctx.globalAlpha = 1;

      // 光标聚光灯（平滑跟随）
      mouse.sx += (mouse.x - mouse.sx) * 0.12;
      mouse.sy += (mouse.y - mouse.sy) * 0.12;
      if (spotRef.current && mouse.x > -999) {
        spotRef.current.style.transform = `translate(${mouse.sx}px, ${mouse.sy}px)`;
      }

      // 点击火花
      sctx.clearRect(0, 0, w, h);
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= s.ring ? 0.035 : 0.022;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        if (s.ring) {
          s.r += 3.2;
          sctx.globalAlpha = s.life * 0.8; sctx.strokeStyle = s.c; sctx.lineWidth = 2;
          sctx.beginPath(); sctx.arc(s.x, s.y, s.r, 0, 6.283); sctx.stroke();
        } else {
          s.x += s.vx; s.y += s.vy; s.vy += 0.12; s.vx *= 0.98;
          sctx.globalAlpha = s.life; sctx.fillStyle = s.c; sctx.shadowColor = s.c; sctx.shadowBlur = 12;
          sctx.beginPath(); sctx.arc(s.x, s.y, s.r * s.life + 0.4, 0, 6.283); sctx.fill();
          sctx.shadowBlur = 0;
        }
      }
      sctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    if (!reduce) raf = requestAnimationFrame(frame);

    const onMove = (e) => {
      mouse.x = e.clientX; mouse.y = e.clientY;
      // 卡片 3D 倾斜 + 高光
      const card = e.target.closest && e.target.closest('.file-card');
      if (card) {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--ry', `${(px - 0.5) * 16}deg`);
        card.style.setProperty('--rx', `${(0.5 - py) * 16}deg`);
        card.style.setProperty('--px', `${px * 100}%`);
        card.style.setProperty('--py', `${py * 100}%`);
      }
    };
    const onOut = (e) => {
      const card = e.target.closest && e.target.closest('.file-card');
      if (card && !card.contains(e.relatedTarget)) {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      }
    };
    const onLeaveWin = () => { mouse.x = -9999; mouse.y = -9999; };
    const onDown = (e) => {
      if (reduce) return;
      const hit = e.target.closest && e.target.closest('button, a, .file-card, .sidebar-item, [role="button"], label');
      if (hit) burst(e.clientX, e.clientY);
    };

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('mouseout', onOut);
    document.documentElement.addEventListener('mouseleave', onLeaveWin);
    return () => {
      cancelAnimationFrame(raf);
      delete window.__vpBurst;
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('mouseout', onOut);
      document.documentElement.removeEventListener('mouseleave', onLeaveWin);
    };
  }, []);

  return (
    <>
      <div className="fx-root" aria-hidden="true">
        <div className="fx-orb o1" />
        <div className="fx-orb o2" />
        <div className="fx-orb o3" />
        <div className="fx-grid" />
        <div className="fx-noise" />
      </div>
      <canvas ref={bgRef} className="fx-canvas" aria-hidden="true" />
      <div ref={spotRef} className="fx-spot" aria-hidden="true" />
      <canvas ref={sparkRef} className="fx-sparks" aria-hidden="true" />
    </>
  );
};

export default FxLayer;

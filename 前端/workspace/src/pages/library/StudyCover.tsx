import { useEffect, useRef, type ReactNode } from "react";
import "./study-cover.css";

type Subject = "library" | "interview";
type Ink = CanvasRenderingContext2D;

function spectrum(ctx: Ink, x1: number, y1: number, x2: number, y2: number, colors: string[]) {
  const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
  colors.forEach((color, i) => gradient.addColorStop(i / (colors.length - 1), color));
  return gradient;
}

// Draw each leaf from the spine out so the curled pages share a vanishing direction.
function drawBook(ctx: Ink) {
  ctx.transform(1, -.16, .38, .91, 221, 144);
  for (let layer = 8; layer >= 0; layer--) {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.translate(0, layer * 2.7);
      const leaf = new Path2D("M0 -44 C28 -79 79 -74 127 -61 L127 42 C83 26 30 28 0 65 Z");
      ctx.fillStyle = layer === 8 ? "#8e8ae6" : layer > 0 ? "#25264f" :
        spectrum(ctx, 0, 0, 128, -22, ["#53547f", "#9c96da", "#deddff", "#aabdec"]);
      ctx.fill(leaf);
      ctx.strokeStyle = layer === 0 ? "#f6f4ff" : "#a8adf0aa";
      ctx.lineWidth = layer === 0 ? 1.5 : .8;
      ctx.stroke(leaf);
      if (layer === 0) {
        ctx.strokeStyle = "#48456c";
        ctx.lineWidth = 1.5;
        for (let line = 0; line < 8; line++) {
          const y = -42 + line * 10;
          ctx.beginPath();
          ctx.moveTo(15, y + 9);
          ctx.bezierCurveTo(41, y - 11, 69, y - 12, line % 3 === 2 ? 89 : 113, y - 5);
          ctx.stroke();
        }
        if (side === 1) {
          ctx.fillStyle = "#6960bb";
          ctx.fill(new Path2D("M82 -68 L94 -67 L94 -18 L88 -23 L82 -18 Z"));
          ctx.fillStyle = "#bdbafa";
          ctx.fillRect(82, -68, 2, 48);
        }
      }
      ctx.restore();
    }
  }
}

function drawMicrophone(ctx: Ink) {
  ctx.translate(226, 131);
  ctx.lineCap = "round";
  // The stand and its reflection sit behind the tilted capsule.
  const metal = spectrum(ctx, -42, -16, 42, 12, ["#4e4f92", "#8f9bea", "#eeedff", "#8882c6", "#4d4680"]);
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.ellipse(0, 93, 43, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-5, 43, 10, 49);
  ctx.rotate(.28);
  ctx.strokeStyle = metal;
  ctx.lineWidth = 8;
  ctx.stroke(new Path2D("M-46 -13 V13 A46 46 0 0 0 46 13 V-13"));
  const body = new Path2D();
  body.roundRect(-33, -90, 66, 128, 33);
  ctx.fillStyle = spectrum(ctx, -34, -8, 35, -22, ["#48406e", "#8884bf", "#ede8ff", "#aab5e9", "#57547f"]);
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = spectrum(ctx, -33, 0, 33, 0, ["#353054", "#79769d", "#9ba4c5", "#575273"]);
  ctx.fillRect(-34, -94, 68, 79);
  ctx.lineWidth = 1.45;
  // Two etched diagonals form the mesh; the highlight follows the curved shell.
  ctx.strokeStyle = spectrum(ctx, -33, 0, 33, 0, ["#847ea9", "#cfcae8", "#fcfbff", "#9391bc"]);
  for (let x = -115; x < 120; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, -95); ctx.lineTo(x + 72, -16);
    ctx.moveTo(x, -95); ctx.lineTo(x - 72, -16);
    ctx.stroke();
  }
  ctx.fillStyle = metal;
  ctx.fillRect(-34, -18, 68, 5);
  ctx.fillStyle = "#4f4c72";
  for (let y = -3; y < 19; y += 6) {
    ctx.beginPath();
    ctx.roundRect(-12, y, 24, 2, 1);
    ctx.fill();
  }
  ctx.restore();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#e4e1ff";
  ctx.stroke(body);
  for (const x of [-45, 45]) {
    ctx.beginPath();
    ctx.arc(x, -12, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#d5d7fc";
    ctx.fill();
  }
}

function drawScene(canvas: HTMLCanvasElement, subject: Subject) {
  const ctx = canvas.getContext("2d");
  const {clientWidth: width, clientHeight: height} = canvas;
  if (!ctx || !width || !height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const scale = Math.min(width / 450, height / 245);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (width - 450 * scale) * dpr / 2, (height - 245 * scale) * dpr / 2);
  const library = subject === "library";
  const glow = ctx.createRadialGradient(225, 132, 12, 225, 132, 165);
  glow.addColorStop(0, library ? "#7d82ff68" : "#aa7bf45c");
  glow.addColorStop(1, "#8783ed00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 450, 245);
  ctx.lineWidth = 1;
  if (library) {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(223, 134, 180 + i * 9, 61 + i * 9, -.18, 0, Math.PI * 2);
      ctx.strokeStyle = i === 1 ? "#aba9ed66" : "#aba9ed29";
      ctx.stroke();
    }
    drawBook(ctx);
  } else {
    for (let x = 12; x < 440; x += 5) {
      const height = 4 + 41 * Math.abs(Math.sin(x * .084) * Math.cos(x * .032)) * Math.sin(x * Math.PI / 450);
      ctx.fillStyle = x > 260 ? "#b6abff91" : "#96b6ff79";
      ctx.fillRect(x, 131 - height, 2, height * 2);
    }
    drawMicrophone(ctx);
  }
}

export function StudyCover({subject, title, children, compact = false}: {
  subject: Subject; title: string; children: ReactNode; compact?: boolean;
}) {
  const art = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = art.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => drawScene(canvas, subject));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [subject]);
  return <header className="study-cover" data-subject={subject} data-compact={compact}>
    <canvas ref={art} aria-hidden="true"/>
    <div className="study-cover-copy"><h1>{title}</h1><div>{children}</div></div>
  </header>;
}

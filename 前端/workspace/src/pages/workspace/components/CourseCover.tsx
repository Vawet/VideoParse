import { useEffect, useRef, useState } from "react";
import { Clock3, Layers3, Pause, Play } from "lucide-react";
import { DEMO_LECTURE } from "../data/lecture";

/** Nested torus sections give the course cover depth without a video or WebGL runtime. */
function SignalArtwork() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    function draw() {
      if (!canvas || !ctx) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const unit = Math.min(width / 3.65, height / 2.87);
      ctx.translate(width * .51, height * .51);
      ctx.scale(unit, unit);
      ctx.rotate(-.38);
      const light = ctx.createLinearGradient(-1.5, -.85, 1.35, .78);
      light.addColorStop(0, "#6485fd");
      light.addColorStop(.24, "#a6daff");
      light.addColorStop(.45, "#f4e7ff");
      light.addColorStop(.67, "#bd8eff");
      light.addColorStop(.84, "#9363fa");
      light.addColorStop(1, "#6479ec");
      ctx.strokeStyle = light;
      // Each line wraps once around the folded surface. Paint back layers first.
      for (let i = 0; i < 108; i++) {
        const s = i / 107;
        const ring = .64 + .70 * s;
        ctx.beginPath();
        for (let j = 0; j <= 300; j++) {
          const angle = (j / 300) * Math.PI * 2;
          const r = ring + (.14 + .12 * s) * Math.sin(3 * angle + 2.5 * s);
          const x = r * Math.cos(angle) * 1.13;
          const fold = .60 * Math.sin(2 * angle + 2.75 * s) + .18 * Math.cos(angle - s);
          const y = r * Math.sin(angle) * .72 + fold * (.7 + .32 * s);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.globalAlpha = .38 + .48 * Math.sin(Math.PI * s);
        ctx.lineWidth = (i % 7 === 0 ? 1.3 : .83) / unit;
        ctx.stroke();
      }
    }
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, []);
  return <div className="signal-field" aria-hidden><div className="signal-orbit"><div className="signal-surface"><canvas ref={ref}/></div></div></div>;
}

export function CourseCover({onPlay}: {onPlay: () => void}) {
  const [paused, setPaused] = useState(false);
  return <section className="course-cover" aria-label="示例课程" data-paused={paused}
    onPointerMove={e => {
      if (paused || e.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const box = e.currentTarget.getBoundingClientRect();
      e.currentTarget.style.setProperty("--tilt-x", ((e.clientX - box.left) / box.width - .5) * 12 + "deg");
      e.currentTarget.style.setProperty("--tilt-y", (.5 - (e.clientY - box.top) / box.height) * 8 + "deg");
    }}
    onPointerLeave={e => {
      e.currentTarget.style.removeProperty("--tilt-x");
      e.currentTarget.style.removeProperty("--tilt-y");
    }}>
    <SignalArtwork/>
    <div className="course-copy">
      <span className="course-kicker"><span aria-hidden/>示例课程</span>
      <h2>注意力机制与<br/><span lang="en">Transformer</span> 入门</h2>
      <p className="course-meta"><span><Clock3 size={14}/>{Math.round(DEMO_LECTURE.duration / 60)} 分钟</span><span><Layers3 size={15}/>{DEMO_LECTURE.segments.length} 章</span></p>
      <button type="button" className="course-play" onClick={onPlay} aria-label="使用示例视频"><Play size={14} fill="currentColor"/>体验示例课程</button>
    </div>
    <button type="button" className="cover-motion" aria-label={paused ? "播放封面动效" : "暂停封面动效"}
      title={paused ? "播放封面动效" : "暂停封面动效"} onClick={() => setPaused(!paused)}>
      {paused ? <Play size={13} fill="currentColor"/> : <Pause size={13} fill="currentColor"/>}
    </button>
  </section>;
}

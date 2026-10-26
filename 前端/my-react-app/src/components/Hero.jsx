import React, { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';

// 逐字弹入的标题
const SplitText = ({ text, className = '', delay = 0 }) => (
  <span aria-label={text}>
    {text.split('').map((c, i) => (
      <span key={i} className={`ch ${className}`} style={{ animationDelay: `${delay + i * 55}ms` }}>
        {c === ' ' ? '\u00A0' : c}
      </span>
    ))}
  </span>
);

// 打字机：循环输入/删除一组短语
const PHRASES = [
  '每一个结论，都有视频里的时间戳作证',
  '像考试一样出题，像老师一样讲解',
  '一门课，所有视频，随问随答',
  '你的薄弱点，自动排成复习计划',
];
const Typewriter = () => {
  const [idx, setIdx] = useState(0);
  const [len, setLen] = useState(0);
  const [del, setDel] = useState(false);
  useEffect(() => {
    const full = PHRASES[idx];
    const t = setTimeout(() => {
      if (!del && len < full.length) setLen(len + 1);
      else if (!del) setDel(true);
      else if (len > 0) setLen(len - 1);
      else { setDel(false); setIdx((idx + 1) % PHRASES.length); }
    }, !del && len === full.length ? 1600 : del ? 22 : 62);
    return () => clearTimeout(t);
  }, [len, del, idx]);
  return <span>{PHRASES[idx].slice(0, len)}<i className="caret" /></span>;
};

// 数字滚动
const CountUp = ({ value }) => {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf, start;
    const from = n;
    const step = (ts) => {
      start = start || ts;
      const p = Math.min((ts - start) / 900, 1);
      setN(Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{n}</>;
};

const FEATURES = [
  ['mdi:message-text-clock-outline', '带时间戳问答'],
  ['mdi:lightbulb-on-outline', '按需出题'],
  ['mdi:shield-check-outline', '证据校验'],
  ['mdi:calendar-check-outline', '复习规划'],
  ['mdi:school-outline', '教师备课'],
];

const Hero = ({ count = 0, categories = 0 }) => (
  <section className="hero">
    <div className="flex flex-wrap items-center justify-between gap-6">
      <div className="min-w-[280px]">
        <div className="text-xs tracking-[0.35em] text-gray-500 mb-3 flex items-center gap-2">
          <span className="live-dot" /> AGENT · EDUCATION EDITION
        </div>
        <h1>
          <SplitText text="让视频" delay={100} />
          <SplitText text="会思考" className="neon-text" delay={400} />
          <SplitText text="，让学习" delay={750} />
          <SplitText text="有据可依" className="neon-text" delay={1150} />
        </h1>
        <p className="mt-4 text-base text-gray-600 h-6">
          <Typewriter />
        </p>
      </div>
      <div className="flex gap-3">
        <div className="stat"><b className="neon-text"><CountUp value={count} /></b><span>解析记录</span></div>
        <div className="stat"><b className="neon-text"><CountUp value={categories} /></b><span>分类</span></div>
      </div>
    </div>
    <div className="flex flex-wrap gap-3 mt-6">
      {FEATURES.map(([icon, label], i) => (
        <span key={label} className="chip" style={{ animationDelay: `${i * 0.5}s, ${0.9 + i * 0.1}s` }}>
          <Icon icon={icon} className="text-lg" /> {label}
        </span>
      ))}
    </div>
  </section>
);

export default Hero;

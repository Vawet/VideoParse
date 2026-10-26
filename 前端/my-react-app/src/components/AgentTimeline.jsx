import React, { useMemo } from 'react';
import { Icon } from '@iconify/react';

const LABELS = {
  get_video_info: '读取视频信息',
  transcribe: '语音识别 (Whisper)',
  correct_transcript: '字幕纠错',
  analyze_structure: '语义分段 & 挑选重点',
  generate_summary: '生成摘要与亮点',
  generate_mindmap: '生成思维导图',
  extract_keyframes: '截取关键帧',
  extract_heavy_frames: '截取重点画面',
  write_frame_notes: '为关键帧撰写笔记',
  view_frame: '查看画面',
  validate_result: '校验结果完整性',
  finish: '汇总并保存结果',
};
// 用于估算进度：流水线的主干步骤
const MAIN_STEPS = ['get_video_info', 'transcribe', 'correct_transcript', 'analyze_structure', 'generate_summary',
  'generate_mindmap', 'extract_keyframes', 'extract_heavy_frames', 'write_frame_notes', 'validate_result', 'finish'];

// 把工具返回的 observation 压成一行人话
function summarize(obs) {
  if (!obs) return '';
  if (obs.error) return `❌ ${obs.error}`;
  if (obs.warning) return `⚠️ ${obs.warning}`;
  if (obs.issues) return obs.ok ? '✅ 没有发现问题' : `发现 ${obs.issues.length} 个问题：${obs.issues.map((i) => i.problem).join('；')}`;
  const parts = [];
  Object.entries(obs).forEach(([k, v]) => {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') parts.push(`${k}: ${v}`);
  });
  return parts.slice(0, 5).join(' · ');
}

const NodeIcon = ({ s }) => {
  if (s.kind === 'thought') return <Icon icon="mdi:thought-bubble-outline" className="text-lg text-violet-300" />;
  if (s.kind === 'error' || s.state === 'error') return <Icon icon="mdi:alert-circle" className="text-lg text-red-500" />;
  if (s.state === 'running') return <span className="tl-spinner" />;
  return <Icon icon="mdi:check-bold" className="text-lg text-green-500" />;
};

const AgentTimeline = ({ events = [], status }) => {
  const steps = useMemo(() => {
    const list = [];
    events.forEach((e) => {
      if (e.type === 'thought') list.push({ kind: 'thought', text: e.text });
      else if (e.type === 'tool_start') list.push({ kind: 'tool', tool: e.tool, state: 'running', args: e.args });
      else if (e.type === 'tool_end') {
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].kind === 'tool' && list[i].tool === e.tool && list[i].state === 'running') {
            list[i] = { ...list[i], state: e.ok ? 'ok' : 'error', summary: summarize(e.observation), ts: e.ts };
            break;
          }
        }
      } else if (e.type === 'error') list.push({ kind: 'error', text: e.text });
    });
    return list;
  }, [events]);

  const finished = new Set(steps.filter((s) => s.kind === 'tool' && s.state === 'ok').map((s) => s.tool));
  const pct = status === 'done' ? 100 : Math.min(97, Math.round((MAIN_STEPS.filter((t) => finished.has(t)).length / MAIN_STEPS.length) * 100));
  const running = status === 'running';

  if (steps.length === 0) {
    return (
      <div className="tl-empty">
        {running ? <div className="radar"><i /><i /><i /></div> : <Icon icon="mdi:robot-outline" className="text-5xl text-gray-400" />}
        <p className="text-sm text-gray-500 mt-4">{running ? 'Agent 正在启动…' : '暂无 Agent 运行记录，上传视频后这里会实时显示它在做什么'}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="tl-head">
        <div className="radar sm" style={{ opacity: running ? 1 : 0.35 }}><i /><i /><i /></div>
        <div className="flex-1">
          <div className="flex justify-between text-xs mb-1.5">
            <span className="tracking-widest text-gray-600">
              {status === 'done' ? 'COMPLETED' : status === 'error' ? 'FAILED' : 'AGENT RUNNING'}
            </span>
            <span className="neon-text font-bold">{pct}%</span>
          </div>
          <div className="tl-bar"><div className={`tl-fill ${running ? 'live' : ''} ${status === 'error' ? 'bad' : ''}`} style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      <ol className="tl-list">
        {steps.map((s, i) => (
          <li key={i} className={`tl-item ${s.state === 'running' ? 'is-running' : ''}`} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
            <span className="tl-node"><NodeIcon s={s} /></span>
            <div className="flex-1 min-w-0 tl-card">
              {s.kind === 'tool' ? (
                <>
                  <div className="text-sm font-semibold text-gray-800">{LABELS[s.tool] || s.tool}</div>
                  {s.args && Object.keys(s.args).length > 0 && (
                    <div className="text-xs text-gray-400 break-all font-mono">{JSON.stringify(s.args)}</div>
                  )}
                  {s.summary && <div className="text-xs text-gray-500 break-all mt-0.5">{s.summary}</div>}
                </>
              ) : (
                <div className={`text-sm ${s.kind === 'error' ? 'text-red-600' : 'text-gray-600 italic'}`}>{s.text}</div>
              )}
            </div>
          </li>
        ))}
        {running && (
          <li className="tl-item">
            <span className="tl-node"><span className="think-dots"><i /><i /><i /></span></span>
            <div className="text-xs text-blue-500 pt-2">Agent 思考中…</div>
          </li>
        )}
      </ol>
    </div>
  );
};

export default AgentTimeline;

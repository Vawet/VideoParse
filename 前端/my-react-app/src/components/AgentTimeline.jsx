import React, { useMemo } from 'react';

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

  if (steps.length === 0) {
    return <p className="text-sm text-gray-500">{status === 'running' ? 'Agent 正在启动…' : '暂无 Agent 运行记录'}</p>;
  }

  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="mt-0.5 w-5 text-center">
            {s.kind === 'thought' ? '💭' : s.kind === 'error' ? '❌' : s.state === 'running' ? '⏳' : s.state === 'ok' ? '✅' : '⚠️'}
          </span>
          <div className="flex-1 min-w-0">
            {s.kind === 'tool' ? (
              <>
                <div className="text-sm font-medium text-gray-800">{LABELS[s.tool] || s.tool}</div>
                {s.args && Object.keys(s.args).length > 0 && (
                  <div className="text-xs text-gray-400 break-all">{JSON.stringify(s.args)}</div>
                )}
                {s.summary && <div className="text-xs text-gray-500 break-all">{s.summary}</div>}
              </>
            ) : (
              <div className={`text-sm ${s.kind === 'error' ? 'text-red-600' : 'text-gray-600 italic'}`}>{s.text}</div>
            )}
          </div>
        </li>
      ))}
      {status === 'running' && <li className="text-xs text-blue-500 pl-8">Agent 思考中…</li>}
    </ol>
  );
};

export default AgentTimeline;

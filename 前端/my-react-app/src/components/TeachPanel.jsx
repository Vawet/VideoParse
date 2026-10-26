import React, { useEffect, useState } from 'react';
import PptxGenJS from 'pptxgenjs';

// 教师备课：后端给出带证据的大纲 + slides JSON，前端用 pptxgenjs 导出 .pptx
const exportPptx = (plan) => {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  plan.slides.forEach((s) => {
    const slide = pptx.addSlide();
    if (s.layout === 'title') {
      slide.addText(s.title, { x: 0.8, y: 2.0, w: 11.5, h: 1.2, fontSize: 40, bold: true, color: '1F2937' });
      slide.addText(s.bullets.join('\n'), { x: 0.8, y: 3.4, w: 11.5, h: 0.8, fontSize: 20, color: '6B7280' });
    } else {
      slide.addText(s.title, { x: 0.6, y: 0.3, w: 12, h: 0.9, fontSize: 30, bold: true, color: '1F2937' });
      slide.addText(s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.8, y: 1.4, w: 11.5, h: 5, fontSize: 22, color: '374151', valign: 'top' });
    }
    if (s.notes) slide.addNotes(s.notes);
  });
  return pptx.writeFile({ fileName: `${plan.topic || '教案'}.pptx` });
};

const TeachPanel = ({ apiBase, onSeek, serverVideoId }) => {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [topic, setTopic] = useState('');
  const [minutes, setMinutes] = useState(45);
  const [plan, setPlan] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${apiBase}/courses`).then((r) => r.json()).then((d) => d.success && setCourses(d.courses)).catch(() => {});
  }, [apiBase]);

  const call = async (path, body) => {
    setLoading(true); setError('');
    try {
      const data = await (await fetch(`${apiBase}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })).json();
      if (data.success) setPlan(data.plan); else setError(data.error);
    } catch (e) {
      setError(`请求失败：${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!serverVideoId) return <p className="text-sm text-gray-500">视频解析并加入课程后可使用备课功能。</p>;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2 items-center">
        <select className="border rounded px-2 py-1" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">选择课程…</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="border rounded px-2 py-1 flex-1 min-w-[160px]" placeholder="本节课主题，如：梯度下降"
               value={topic} onChange={(e) => setTopic(e.target.value)} />
        <label>课时 <input type="number" min="5" max="240" className="border rounded px-2 py-1 w-20" value={minutes}
                          onChange={(e) => setMinutes(Number(e.target.value))} /> 分钟</label>
        <button className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
                disabled={!courseId || !topic.trim() || loading}
                onClick={() => call('/teach/plan', { course_id: courseId, topic, minutes })}>
          {loading ? '生成中…' : '生成教案'}
        </button>
      </div>
      {error && <p className="text-red-600">⚠️ {error}</p>}

      {plan && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h4 className="font-semibold">{plan.topic}（第 {plan.version} 版 · {plan.minutes} 分钟）</h4>
            <button className="px-3 py-1 bg-gray-800 text-white rounded" onClick={() => exportPptx(plan)}>导出 PPTX</button>
            {plan.dropped_points > 0 && (
              <span className="text-xs text-gray-400">已自动丢弃 {plan.dropped_points} 个无法核对依据的要点</span>
            )}
          </div>
          {plan.sections.map((s) => (
            <div key={s.title} className="border rounded p-2 bg-white">
              <div className="font-medium">{s.title}　<span className="text-gray-400">{s.minutes} 分钟</span></div>
              <ul className="list-disc pl-5">
                {s.points.map((p, i) => (
                  <li key={i}>
                    {p.text}{' '}
                    <button type="button" className="text-xs text-blue-700 underline" title={p.evidence.quote}
                            disabled={p.evidence.video_id !== serverVideoId}
                            onClick={() => onSeek && onSeek(p.evidence.time)}>
                      ▶ {p.evidence.time}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {plan.homework && (
            <div className="border rounded p-2 bg-white">
              <div className="font-medium">课后作业（含答案，教师可见）</div>
              {plan.homework.questions.length === 0 && <p className="text-gray-500">{plan.homework.reason}</p>}
              {plan.homework.questions.map((q, i) => (
                <div key={q.id} className="py-1">
                  {i + 1}. {q.stem}
                  {q.options && <div className="text-gray-500 text-xs">{q.options.map((o, k) => `${'ABCD'[k]}. ${o}`).join('　')}</div>}
                  <div className="text-xs text-green-700">答案：{q.answer}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input className="border rounded px-2 py-1 flex-1" placeholder="修改要求，如：压缩到 30 分钟，多一些例子"
                   value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            <button className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
                    disabled={!instruction.trim() || loading}
                    onClick={() => { call(`/teach/plan/${plan.plan_id}/revise`, { instruction }); setInstruction(''); }}>
              修改
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeachPanel;

import React, { useEffect, useState } from 'react';
import { getClientId } from '../utils/clientId';

// 薄弱点 + 复习计划：日期/条目/时间戳由后端按答题记录生成，LLM 只写每天一句建议
const ReviewPanel = ({ serverVideoId, apiBase, onSeek }) => {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [examDate, setExamDate] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [weak, setWeak] = useState(null);
  const [plan, setPlan] = useState(null);
  const [done, setDone] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const clientId = getClientId();

  useEffect(() => {
    fetch(`${apiBase}/courses`).then((r) => r.json()).then((d) => d.success && setCourses(d.courses)).catch(() => {});
  }, [apiBase]);

  useEffect(() => {
    if (!courseId) { setWeak(null); return; }
    fetch(`${apiBase}/review/weak?client_id=${clientId}&course_id=${courseId}`)
      .then((r) => r.json()).then((d) => d.success && setWeak(d)).catch(() => {});
  }, [courseId, apiBase, clientId]);

  const generate = async () => {
    setLoading(true); setError('');
    try {
      const resp = await fetch(`${apiBase}/review/plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, course_id: courseId, exam_date: examDate || undefined, daily_minutes: minutes }),
      });
      const data = await resp.json();
      if (data.success) { setPlan(data.plan); setDone([]); } else setError(data.error);
    } catch (e) {
      setError(`请求失败：${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (item) => {
    const isDone = done.includes(item.id);
    setDone(isDone ? done.filter((i) => i !== item.id) : [...done, item.id]);
    await fetch(`${apiBase}/review/done`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, course_id: courseId, item_id: item.id, done: !isDone }),
    });
  };

  if (!serverVideoId) return <p className="text-sm text-gray-500">视频解析完成后可使用复习规划。</p>;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-gray-500">复习规划基于一门课程里你的答题记录。先在「视频问答/练习」里做几道题，并把视频加入课程。</p>
      <div className="flex flex-wrap gap-2 items-center">
        <select className="border rounded px-2 py-1" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">选择课程…</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" className="border rounded px-2 py-1" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
        <label>每天 <input type="number" min="10" step="10" className="border rounded px-2 py-1 w-20" value={minutes}
                          onChange={(e) => setMinutes(Number(e.target.value))} /> 分钟</label>
        <button className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50" disabled={!courseId || loading} onClick={generate}>
          生成计划
        </button>
      </div>
      {error && <p className="text-red-600">⚠️ {error}</p>}
      {weak && (
        <div>
          <h4 className="font-semibold mb-1">薄弱知识点</h4>
          {weak.topics.length === 0 && <p className="text-gray-500">还没有答题记录。</p>}
          {weak.topics.map((t) => (
            <div key={t.topic} className={t.weak ? 'text-red-700' : 'text-gray-600'}>
              {t.weak ? '⚠️' : '✅'} {t.topic}：答对率 {Math.round(t.accuracy * 100)}%（{t.attempted} 题）
            </div>
          ))}
        </div>
      )}
      {plan && (
        <div className="space-y-2">
          {plan.days.map((d) => (
            <div key={d.date} className="border rounded p-2 bg-white">
              <div className="font-medium">{d.date}　<span className="text-gray-400">{d.minutes} 分钟</span></div>
              {d.tip && <div className="text-gray-500 text-xs mb-1">💡 {d.tip}</div>}
              {d.items.map((it) => (
                <div key={it.id} className="flex items-start gap-2 py-1">
                  <input type="checkbox" checked={done.includes(it.id)} onChange={() => toggle(it)} />
                  <div className={done.includes(it.id) ? 'line-through text-gray-400' : ''}>
                    <div>{it.topic}　<span className="text-gray-400">{it.minutes} 分钟</span></div>
                    <div className="text-xs text-gray-500">{it.reason}</div>
                    {it.video_id && (
                      <button type="button" className="text-xs text-blue-700 underline"
                              disabled={it.video_id !== serverVideoId}
                              title={it.quote} onClick={() => onSeek && onSeek(it.time)}>
                        ▶ {it.video_title} {it.time}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {plan.overflow.length > 0 && <p className="text-xs text-gray-500">另有 {plan.overflow.length} 项在日程内排不下，可增加每日时长。</p>}
        </div>
      )}
    </div>
  );
};

export default ReviewPanel;

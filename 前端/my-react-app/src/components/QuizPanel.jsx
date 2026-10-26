import React, { useState } from 'react';
import { getClientId } from '../utils/clientId';

// 按需出题：题目全部带"字幕原话+时间戳"依据，答完才显示答案与解析
const QuizPanel = ({ serverVideoId, apiBase, onSeek }) => {
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(3);
  const [difficulty, setDifficulty] = useState('medium');
  const [loading, setLoading] = useState(false);
  const [quiz, setQuiz] = useState(null); // {quiz_id, questions, reason?}
  const [picked, setPicked] = useState({}); // question_id -> 作答内容
  const [results, setResults] = useState({}); // question_id -> 判分结果
  const [error, setError] = useState('');

  const post = async (path, body) => (await fetch(`${apiBase}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).json();

  const generate = async () => {
    setLoading(true); setError(''); setQuiz(null); setPicked({}); setResults({});
    try {
      const data = await post('/quiz/generate', { video_id: serverVideoId, topic, count, difficulty });
      if (!data.success) setError(data.error);
      else setQuiz(data);
    } catch (e) {
      setError(`请求失败：${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const submit = async (q) => {
    const answer = picked[q.id];
    if (!answer) return;
    const data = await post(`/quiz/${quiz.quiz_id}/answer`, { client_id: getClientId(), question_id: q.id, answer });
    if (data.success) setResults((r) => ({ ...r, [q.id]: data }));
    else setError(data.error);
  };

  if (!serverVideoId) return <p className="text-sm text-gray-500">视频解析完成后即可出题练习。</p>;

  const choices = (q) => (q.qtype === 'judge' ? ['对', '错'] : q.options?.map((o, i) => `${'ABCD'[i]}`) || []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input className="border rounded px-2 py-1 flex-1 min-w-[160px]" placeholder="知识点（留空=全片）"
               value={topic} onChange={(e) => setTopic(e.target.value)} />
        <select className="border rounded px-2 py-1" value={count} onChange={(e) => setCount(Number(e.target.value))}>
          {[1, 3, 5, 8].map((n) => <option key={n} value={n}>{n} 题</option>)}
        </select>
        <select className="border rounded px-2 py-1" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option>
        </select>
        <button className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50" disabled={loading} onClick={generate}>
          {loading ? '出题中…' : '出题'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">⚠️ {error}</p>}
      {quiz && quiz.questions.length === 0 && (
        <p className="text-sm text-gray-600">{quiz.reason || '没有生成出能通过引用校验的题目'}</p>
      )}
      {quiz && quiz.rejected_by_verification > 0 && (
        <p className="text-xs text-gray-400">已自动丢弃 {quiz.rejected_by_verification} 道无法在字幕中找到依据的题。</p>
      )}
      {quiz?.questions.map((q, idx) => {
        const res = results[q.id];
        return (
          <div key={q.id} className="border rounded p-3 text-sm bg-white">
            <div className="font-medium mb-2">{idx + 1}. {q.stem}</div>
            {q.qtype === 'blank' ? (
              <input className="border rounded px-2 py-1 w-full" disabled={!!res} placeholder="填写答案"
                     value={picked[q.id] || ''} onChange={(e) => setPicked({ ...picked, [q.id]: e.target.value })} />
            ) : (
              <div className="space-y-1">
                {choices(q).map((c, i) => (
                  <label key={c} className="flex gap-2 items-center">
                    <input type="radio" name={q.id} disabled={!!res} checked={picked[q.id] === c}
                           onChange={() => setPicked({ ...picked, [q.id]: c })} />
                    <span>{q.qtype === 'single' ? `${c}. ${q.options[i]}` : c}</span>
                  </label>
                ))}
              </div>
            )}
            {!res && (
              <button className="mt-2 px-3 py-1 bg-gray-800 text-white rounded disabled:opacity-40"
                      disabled={!picked[q.id]} onClick={() => submit(q)}>提交</button>
            )}
            {res && (
              <div className={`mt-2 p-2 rounded ${res.correct ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                <div>{res.correct ? '✅ 回答正确' : `❌ 回答错误，正确答案：${res.answer}`}</div>
                {res.explanation && <div className="mt-1">{res.explanation}</div>}
                <div className="mt-1 flex flex-wrap gap-1">
                  {res.evidence?.map((e, i) => (
                    <button key={i} type="button" title={e.quote} onClick={() => onSeek && onSeek(String(e.start))}
                            className="text-xs px-2 py-0.5 rounded border bg-white text-blue-700 border-blue-200">
                      ▶ {Math.floor(e.start / 60)}:{String(Math.floor(e.start % 60)).padStart(2, '0')}「{e.quote.slice(0, 18)}…」
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default QuizPanel;

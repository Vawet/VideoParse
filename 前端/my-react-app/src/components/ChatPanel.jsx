import React, { useEffect, useRef, useState } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { getClientId } from '../utils/clientId';

// 证据标签：有效引用可点击跳转；无法在字幕中核实的引用标红提示
const CitationChips = ({ citations, currentVideoId, onSeek }) => {
  if (!citations || citations.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {citations.map((c, i) => {
        const sameVideo = !c.video_id || c.video_id === currentVideoId;
        const label = `${c.video_title && c.video_id ? c.video_title + ' ' : ''}${c.time}`;
        if (!c.valid) {
          return (
            <span key={i} className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600 border border-red-200"
                  title="这个时间戳无法在字幕中核实，请谨慎对待">
              ⚠️ {label}
            </span>
          );
        }
        return (
          <button
            key={i}
            type="button"
            disabled={!sameVideo}
            title={c.text}
            onClick={() => sameVideo && onSeek && onSeek(c.time)}
            className={`text-xs px-2 py-0.5 rounded border ${
              sameVideo
                ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                : 'bg-gray-50 text-gray-500 border-gray-200 cursor-default'
            }`}
          >
            ▶ {label}
          </button>
        );
      })}
    </div>
  );
};

const ChatPanel = ({ serverVideoId, apiBase, onSeek }) => {
  const [scope, setScope] = useState('video'); // video | course
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [notice, setNotice] = useState('');
  const [messages, setMessages] = useState([]); // {role, content, tools?, citations?}
  const [history, setHistory] = useState([]); // 发给后端的纯文本历史
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadCourses = async () => {
    try {
      const data = await (await fetch(`${apiBase}/courses`)).json();
      if (data.success) setCourses(data.courses);
    } catch (e) {
      setNotice(`获取课程失败：${e.message}`);
    }
  };

  useEffect(() => {
    if (scope === 'course') loadCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const switchScope = (next) => {
    if (next === scope) return;
    setScope(next);
    setMessages([]); // 不同范围的对话不混用
    setHistory([]);
    setNotice('');
  };

  const post = async (path, body) => {
    const resp = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return resp.json();
  };

  const createCourse = async () => {
    const name = window.prompt('新课程名称');
    if (!name || !name.trim()) return;
    const data = await post('/courses', { name: name.trim() });
    if (!data.success) return setNotice(data.error);
    const added = await post(`/courses/${data.course.id}/videos`, { video_id: serverVideoId });
    setNotice(added.success ? `已创建「${data.course.name}」并加入当前视频` : added.error);
    await loadCourses();
    setCourseId(data.course.id);
  };

  const addCurrentVideo = async () => {
    const data = await post(`/courses/${courseId}/videos`, { video_id: serverVideoId });
    setNotice(data.success ? '已把当前视频加入该课程' : data.error);
    await loadCourses();
  };

  const send = async () => {
    const question = input.trim();
    if (!question || loading) return;
    if (scope === 'course' && !courseId) return setNotice('请先选择一门课程');
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: question }]);
    setLoading(true);
    try {
      const body = scope === 'course'
        ? { course_id: courseId, question, history, client_id: getClientId() }
        : { video_id: serverVideoId, question, history, client_id: getClientId() };
      const data = await post('/chat', body);
      if (data.success) {
        setHistory(data.history);
        setMessages((m) => [...m, {
          role: 'assistant', content: data.answer, tools: data.tools_used, citations: data.citations,
        }]);
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${data.error}` }]);
      }
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ 请求失败：${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  if (!serverVideoId) {
    return <p className="text-sm text-gray-500">视频解析完成后即可对视频提问。</p>;
  }

  const tabCls = (active) =>
    `px-3 py-1 text-xs rounded-full border ${active ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-600 border-gray-300'}`;

  return (
    <div className="flex flex-col h-[70vh]">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <button className={tabCls(scope === 'video')} onClick={() => switchScope('video')}>本视频</button>
        <button className={tabCls(scope === 'course')} onClick={() => switchScope('course')}>整门课</button>
        {scope === 'course' && (
          <>
            <select
              className="text-xs border border-gray-300 rounded px-2 py-1"
              value={courseId}
              onChange={(e) => { setCourseId(e.target.value); setMessages([]); setHistory([]); }}
            >
              <option value="">选择课程…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}（{c.video_count} 个视频）</option>
              ))}
            </select>
            <button className="text-xs text-blue-600 underline" onClick={createCourse}>新建课程</button>
            {courseId && (
              <button className="text-xs text-blue-600 underline" onClick={addCurrentVideo}>加入当前视频</button>
            )}
          </>
        )}
        {notice && <span className="text-xs text-gray-500">{notice}</span>}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.length === 0 && (
          <p className="text-sm text-gray-500">
            {scope === 'course'
              ? '试试问：“这几讲里关于 XX 分别是怎么讲的？有什么联系？”'
              : '试试问：“这个视频的核心结论是什么？”、“考我 3 道题”、“讲到 XX 的地方在哪？”'}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
              }`}
            >
              {m.role === 'user' ? m.content : <MDEditor.Markdown source={m.content} style={{ background: 'transparent' }} />}
            </div>
            {m.role === 'assistant' && (
              <CitationChips citations={m.citations} currentVideoId={serverVideoId} onSeek={onSeek} />
            )}
            {m.tools && m.tools.length > 0 && (
              <div className="text-xs text-gray-400 mt-1">用到工具：{m.tools.join(' → ')}</div>
            )}
          </div>
        ))}
        {loading && <div className="text-xs text-blue-500">Agent 正在检索字幕/查看画面…</div>}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 pt-3 border-t border-gray-200 mt-3">
        <input
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          placeholder={scope === 'course' ? '向整门课提问…' : '向这个视频提问…'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && send()}
        />
        <button
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded disabled:opacity-50"
          disabled={loading || !input.trim()}
          onClick={send}
        >
          发送
        </button>
      </div>
    </div>
  );
};

export default ChatPanel;

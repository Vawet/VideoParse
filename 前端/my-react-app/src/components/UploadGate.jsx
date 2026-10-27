import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// 上传前的口令提问：答案只在后端校验，这里只负责收集输入并显示错误
const UploadGate = ({ open, question, onSubmit, onCancel }) => {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setAnswer(''); setError(''); setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (busy) return;
    if (!answer.trim()) { setError('请输入答案'); return; }
    setBusy(true);
    const err = await onSubmit(answer);
    if (err) { setError(err); setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 modal-overlay">
      <div className="bg-white rounded-lg w-full max-w-sm p-6 shadow-2xl modal-card">
        <h3 className="text-xl font-bold neon-text mb-1">上传验证</h3>
        <p className="text-sm text-gray-500 mb-5">回答正确后才能上传视频</p>
        <label className="block text-sm font-medium text-gray-700 mb-1">{question}</label>
        <input
          ref={inputRef}
          type="text"
          value={answer}
          onChange={(e) => { setAnswer(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
          placeholder="请输入答案"
        />
        {error && <div key={error} className="form-error" role="alert">{error}</div>}
        <div className="flex justify-end space-x-3 mt-6">
          <button onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition">取消</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition disabled:opacity-60">
            {busy ? '验证中…' : '验证并上传'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default UploadGate;

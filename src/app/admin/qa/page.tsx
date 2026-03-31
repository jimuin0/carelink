'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

interface QAItem {
  id: string;
  facility_id: string;
  user_id: string;
  question: string;
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  status: 'pending' | 'answered';
  is_public: boolean;
  created_at: string;
}

export default function AdminQAPage() {
  const [qaList, setQaList] = useState<QAItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'answered'>('all');
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [saving, setSaving] = useState(false);

  const loadQA = useCallback(async (fId: string) => {
    const supabase = createBrowserSupabaseClient();
    const { data } = await supabase
      .from('facility_qa')
      .select('*')
      .eq('facility_id', fId)
      .order('created_at', { ascending: false })
      .limit(100);
    setQaList((data ?? []) as QAItem[]);
  }, []);

  useEffect(() => {
    const init = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      const { data: membership } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (!membership) { setLoading(false); return; }
      setFacilityId(membership.facility_id);
      await loadQA(membership.facility_id);
      setLoading(false);
    };
    init().catch(() => setLoading(false));
  }, [loadQA]);

  const handleAnswer = async () => {
    if (!answeringId || !answerText.trim() || !facilityId || !userId || saving) return;
    setSaving(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase
        .from('facility_qa')
        .update({
          answer: answerText.trim(),
          answered_by: userId,
          answered_at: new Date().toISOString(),
          status: 'answered',
        })
        .eq('id', answeringId)
        .eq('facility_id', facilityId);
      if (error) throw error;
      setToast({ type: 'success', message: '回答を送信しました' });
      setAnsweringId(null);
      setAnswerText('');
      await loadQA(facilityId);
    } catch {
      setToast({ type: 'error', message: '回答の送信に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  const togglePublic = async (qa: QAItem) => {
    if (!facilityId) return;
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase
        .from('facility_qa')
        .update({ is_public: !qa.is_public })
        .eq('id', qa.id)
        .eq('facility_id', facilityId);
      if (error) throw error;
      setToast({ type: 'success', message: qa.is_public ? '非公開にしました' : '公開にしました' });
      await loadQA(facilityId);
    } catch {
      setToast({ type: 'error', message: '更新に失敗しました' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!facilityId) return;
    if (!window.confirm('このQ&Aを削除しますか？')) return;
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.from('facility_qa').delete().eq('id', id).eq('facility_id', facilityId);
      if (error) throw error;
      setToast({ type: 'success', message: '削除しました' });
      await loadQA(facilityId);
    } catch {
      setToast({ type: 'error', message: '削除に失敗しました' });
    }
  };

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }

  const filtered = qaList.filter((qa) => {
    if (filter === 'pending') return qa.status === 'pending';
    if (filter === 'answered') return qa.status === 'answered';
    return true;
  });

  const pendingCount = qaList.filter((q) => q.status === 'pending').length;

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Q&A管理</h1>
        {pendingCount > 0 && (
          <span className="bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
            未回答 {pendingCount}件
          </span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(['all', 'pending', 'answered'] as const).map((f) => (
          <button
            type="button"
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              filter === f
                ? 'bg-sky-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            {f === 'all' ? `すべて(${qaList.length})` : f === 'pending' ? `未回答(${pendingCount})` : `回答済(${qaList.length - pendingCount})`}
          </button>
        ))}
      </div>

      {/* Answer Modal */}
      {answeringId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) { setAnsweringId(null); setAnswerText(''); } }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold mb-4">回答を入力</h2>
            <div className="bg-gray-50 rounded-lg p-3 mb-4">
              <p className="text-xs text-gray-400 mb-1">質問</p>
              <p className="text-sm">{qaList.find((q) => q.id === answeringId)?.question}</p>
            </div>
            <div>
              <label htmlFor="qa-answer" className="form-label">回答 <span className="text-red-500">*</span></label>
              <textarea
                id="qa-answer"
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                className="form-input"
                rows={5}
                maxLength={1000}
                placeholder="お客様への回答を入力してください"
              />
              <p className="text-xs text-gray-400 mt-1 text-right">{answerText.length}/1000</p>
            </div>
            <div className="flex gap-3 mt-4">
              <button type="button" onClick={() => { setAnsweringId(null); setAnswerText(''); }} className="flex-1 py-2.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">キャンセル</button>
              <button type="button" onClick={handleAnswer} disabled={saving || !answerText.trim()} className="btn-primary flex-1 !py-2.5">{saving ? '送信中...' : '回答を送信'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Q&A List */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="text-gray-400">
            {filter === 'pending' ? '未回答の質問はありません' : filter === 'answered' ? '回答済みの質問はありません' : 'Q&Aはまだありません'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((qa) => (
            <div key={qa.id} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-start gap-3">
                <span className={`shrink-0 w-6 h-6 text-white text-xs font-bold rounded-full flex items-center justify-center mt-0.5 ${qa.status === 'pending' ? 'bg-red-400' : 'bg-sky-500'}`}>Q</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{qa.question}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-gray-400">{formatDate(qa.created_at)}</span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${qa.status === 'pending' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
                      {qa.status === 'pending' ? '未回答' : '回答済'}
                    </span>
                    {qa.status === 'answered' && (
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${qa.is_public ? 'bg-sky-50 text-sky-600' : 'bg-gray-100 text-gray-500'}`}>
                        {qa.is_public ? '公開' : '非公開'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {qa.status === 'pending' ? (
                    <button
                      type="button"
                      onClick={() => { setAnsweringId(qa.id); setAnswerText(qa.answer || ''); }}
                      className="text-xs bg-sky-500 text-white px-3 py-1.5 rounded-lg hover:bg-sky-600 transition-colors"
                    >
                      回答する
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => togglePublic(qa)} className="p-2 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" aria-label={qa.is_public ? '非公開にする' : '公開にする'}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {qa.is_public
                            ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                          }
                        </svg>
                      </button>
                      <button type="button" onClick={() => { setAnsweringId(qa.id); setAnswerText(qa.answer || ''); }} className="p-2 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" aria-label="編集">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => handleDelete(qa.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" aria-label="削除">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>

              {/* Answer preview */}
              {qa.answer && (
                <div className="mt-3 ml-9 flex items-start gap-3 bg-gray-50 rounded-lg p-3">
                  <span className="shrink-0 w-5 h-5 bg-amber-500 text-white text-micro font-bold rounded-full flex items-center justify-center mt-0.5">A</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 whitespace-pre-line">{qa.answer}</p>
                    <p className="text-xs text-gray-400 mt-1">回答日: {formatDate(qa.answered_at)}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}

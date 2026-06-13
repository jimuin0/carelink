'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

interface QAItem {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  is_public: boolean;
  created_at: string;
  answered_at: string | null;
}

export default function QASection({ facilityId }: { facilityId: string }) {
  const [qaList, setQaList] = useState<QAItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadQA = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    const { data, error } = await supabase
      .from('facility_qa')
      .select('id, question, answer, status, is_public, created_at, answered_at')
      .eq('facility_id', facilityId)
      .eq('status', 'answered')
      .eq('is_public', true)
      .order('answered_at', { ascending: false });
    if (error) { setLoadError(true); return; }
    setQaList((data ?? []) as QAItem[]);
  }, [facilityId]);

  useEffect(() => {
    const init = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
      await loadQA();
      setLoading(false);
    };
    init().catch(() => { setLoadError(true); setLoading(false); });
  }, [loadQA]);

  const handleSubmit = async () => {
    if (!question.trim() || !userId || submitting) return;
    setSubmitting(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.from('facility_qa').insert({
        facility_id: facilityId,
        user_id: userId,
        question: question.trim(),
        status: 'pending',
        is_public: true,
      });
      if (error) throw error;
      setQuestion('');
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 4000);
    } catch {
      // silent
    } finally {
      setSubmitting(false);
    }
  };

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Question Form (logged in users only) */}
      {userId && (
        <div className="bg-sky-50 rounded-xl p-4">
          <h4 className="text-sm font-bold mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            質問を投稿する
          </h4>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="この施設について気になることを質問してみましょう"
            aria-label="質問を入力"
            className="form-input text-sm"
            rows={3}
            maxLength={500}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-400">{question.length}/500</span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !question.trim()}
              className="bg-sky-500 text-white text-sm px-4 py-2 rounded-lg hover:bg-sky-600 transition-colors disabled:opacity-50"
            >
              {submitting ? '送信中...' : '質問する'}
            </button>
          </div>
          {submitted && (
            <p className="text-sm text-green-600 mt-2">質問を送信しました。施設からの回答をお待ちください。</p>
          )}
        </div>
      )}

      {/* Q&A List */}
      {loadError ? (
        <div className="text-center py-8" role="alert">
          <p className="text-sm text-rose-600 font-bold">Q&Aの読み込みに失敗しました</p>
          <button type="button" onClick={() => loadQA()} className="text-xs text-sky-600 underline mt-1">再試行</button>
        </div>
      ) : qaList.length === 0 ? (
        <p className="text-gray-400 text-center py-8">Q&Aはまだありません。</p>
      ) : (
        <div className="space-y-3">
          {qaList.map((qa) => (
            <div key={qa.id} className="bg-gray-50 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === qa.id ? null : qa.id)}
                aria-expanded={expandedId === qa.id}
                className="w-full text-left p-4 flex items-start gap-3"
              >
                <span className="shrink-0 w-6 h-6 bg-sky-500 text-white text-xs font-bold rounded-full flex items-center justify-center mt-0.5">Q</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{qa.question}</p>
                  <p className="text-xs text-gray-400 mt-1">{formatDate(qa.created_at)}</p>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 shrink-0 mt-1 transition-transform ${expandedId === qa.id ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedId === qa.id && qa.answer && (
                <div className="px-4 pb-4 flex items-start gap-3">
                  <span className="shrink-0 w-6 h-6 bg-amber-500 text-white text-xs font-bold rounded-full flex items-center justify-center mt-0.5">A</span>
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
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import { FACILITY_QA_QUESTION_MAX_LENGTH } from '@/lib/facility-qa-limits';
import Button from '@/components/ui/Button';

const SUBMIT_FAILED_MESSAGE = '質問の送信に失敗しました。もう一度お試しください。';

interface QAItem {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  is_public: boolean;
  created_at: string;
  answered_at: string | null;
}

/** 質問だけを受け付ける入口の id（ログイン後にここへ戻す）。 */
export const QA_ASK_ANCHOR = 'qa-ask';

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
const readHash = () => window.location.hash;
const readServerHash = () => '';

interface Props {
  facilityId: string;
  /**
   * 質問の投稿欄だけを出す（一覧は読まない）。公開中の Q&A が 0 件でタブを出さない施設でも、
   * 質問する機能そのものは残すための入口（神原さん判断 2026年10月23日）。お問い合わせ欄の下に置く。
   */
  askOnly?: boolean;
  /** askOnly で未ログインのときに出すログイン導線（戻り先は #qa-ask）。 */
  loginHref?: string;
}

export default function QASection({ facilityId, askOnly = false, loginHref }: Props) {
  const hash = useSyncExternalStore(subscribeHash, readHash, readServerHash);
  // 利用者が開閉したらその状態を優先する。ログインから #qa-ask で戻ってきたときは開いた状態で出す。
  const [toggled, setToggled] = useState<boolean | null>(null);
  const askOpen = toggled ?? hash === `#${QA_ASK_ANCHOR}`;
  const [qaList, setQaList] = useState<QAItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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
      if (!askOnly) await loadQA();
      setLoading(false);
    };
    init().catch(() => { setLoadError(true); setLoading(false); });
  }, [loadQA, askOnly]);

  // 質問はサーバーの API が保存し、店舗へメールで知らせる（2026年10月22日）。以前はブラウザから
  // facility_qa へ直接 INSERT しており、店舗には何も届かず、回答欄まで自由に書けた。
  const handleSubmit = async () => {
    if (!question.trim() || !userId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/facility/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facility_id: facilityId, question: question.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: unknown } | null;
        // 入力・回数制限・ログイン切れなど、利用者が次の行動を取れる理由はそのまま見せる。
        const message = res.status < 500 && typeof body?.error === 'string' ? body.error : SUBMIT_FAILED_MESSAGE;
        setToast({ type: 'error', message });
        return;
      }
      setQuestion('');
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 4000);
    } catch {
      setToast({ type: 'error', message: SUBMIT_FAILED_MESSAGE });
    } finally {
      setSubmitting(false);
    }
  };

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }

  const questionForm = (
    <div className="bg-sky-50 rounded-xl p-4">
      <h4 className="text-sm font-bold mb-2 flex items-center gap-2">
        <svg className="w-4 h-4 text-sky-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        maxLength={FACILITY_QA_QUESTION_MAX_LENGTH}
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-500">{question.length}/{FACILITY_QA_QUESTION_MAX_LENGTH}</span>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={submitting || !question.trim()}
        >
          {submitting ? '送信中...' : '質問する'}
        </Button>
      </div>
      {submitted && (
        <p className="text-sm text-green-700 mt-2" role="status">質問を送信しました。施設からの回答をお待ちください。</p>
      )}
    </div>
  );

  if (askOnly) {
    return (
      <details
        id={QA_ASK_ANCHOR}
        open={askOpen}
        onToggle={(e) => setToggled(e.currentTarget.open)}
        className="group scroll-mt-20 mt-6 border-t border-gray-100 pt-4"
      >
        <summary className="cursor-pointer list-none inline-flex items-center gap-1 min-h-[44px] text-sm font-bold text-sky-700 hover:underline [&::-webkit-details-marker]:hidden">
          この施設に質問する
          <svg className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="mt-2 space-y-3">
          <p className="text-xs text-gray-500">お店への質問を送れます。お店が回答して公開すると、このページの「Q&A」に掲載されます。</p>
          {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
          {loading ? (
            <div className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ) : userId ? questionForm : (
            <p className="text-sm text-gray-600">
              質問の投稿にはログインが必要です。
              {loginHref && <a href={loginHref} className="text-sky-700 underline ml-1">ログインして質問する</a>}
            </p>
          )}
        </div>
      </details>
    );
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
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      {/* Question Form (logged in users only) */}
      {userId && questionForm}

      {/* Q&A List */}
      {loadError ? (
        <div className="text-center py-8" role="alert">
          <p className="text-sm text-rose-600 font-bold">Q&Aの読み込みに失敗しました</p>
          <button type="button" onClick={() => loadQA()} className="text-xs text-sky-700 underline mt-1">再試行</button>
        </div>
      ) : qaList.length === 0 ? (
        <p className="text-gray-500 text-center py-8">Q&Aはまだありません。</p>
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
                  <p className="text-xs text-gray-500 mt-1">{formatDate(qa.created_at)}</p>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-500 shrink-0 mt-1 transition-transform ${expandedId === qa.id ? 'rotate-180' : ''}`}
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
                    <p className="text-xs text-gray-500 mt-1">回答日: {formatDate(qa.answered_at)}</p>
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

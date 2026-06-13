'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';

interface ModerationItem {
  id: string;
  content_type: string;
  content_id: string;
  facility_id: string | null;
  report_reason: string | null;
  auto_flags: string[];
  status: 'pending' | 'approved' | 'rejected' | 'escalated';
  review_note: string | null;
  created_at: string;
  // joined
  facility_name?: string;
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  review:       '口コミ',
  photo:        '写真',
  qa_answer:    'Q&A回答',
  blog_comment: 'ブログコメント',
};

const STATUS_CONFIG = {
  pending:   { label: '未審査', className: 'bg-amber-100 text-amber-700' },
  approved:  { label: '承認済み', className: 'bg-emerald-100 text-emerald-700' },
  rejected:  { label: '却下', className: 'bg-red-100 text-red-700' },
  escalated: { label: 'エスカレーション', className: 'bg-purple-100 text-purple-700' },
};

export default function ModerationPage() {
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    let query = supabase
      .from('moderation_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (statusFilter) query = query.eq('status', statusFilter);
    setLoadError(false);
    const { data, error } = await query;
    if (error) { setLoadError(true); setLoading(false); return; }
    setItems(data ?? []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleDecision = async (id: string, decision: 'approved' | 'rejected' | 'escalated') => {
    const res = await fetch(`/api/admin/moderation/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, review_note: reviewNote || null }),
    });

    if (!res.ok) {
      setToast({ type: 'error', message: '更新に失敗しました' });
      return;
    }

    const labels = { approved: '承認', rejected: '却下', escalated: 'エスカレーション' };
    setToast({ type: 'success', message: `${labels[decision]}しました` });
    setReviewingId(null);
    setReviewNote('');
    load();
  };

  const pendingCount = items.filter(i => i.status === 'pending').length;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">コンテンツモデレーション</h1>
          {pendingCount > 0 && statusFilter === 'pending' && (
            <p className="text-sm text-amber-600 mt-0.5">{pendingCount}件の未審査コンテンツがあります</p>
          )}
        </div>
        <button type="button" onClick={load} className="text-sm px-3 py-1.5 bg-sky-100 text-sky-700 rounded-lg hover:bg-sky-200">更新</button>
      </div>

      {/* フィルター */}
      <div className="flex gap-2">
        {(['pending', 'approved', 'rejected', 'escalated', ''] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              statusFilter === s
                ? 'bg-sky-500 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s === '' ? 'すべて' : STATUS_CONFIG[s as keyof typeof STATUS_CONFIG]?.label ?? s}
          </button>
        ))}
      </div>

      {/* キュー一覧 */}
      {loading ? (
        <div className="py-12 text-center">
          <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : loadError ? (
        <LoadError onRetry={load} message="審査キューの読み込みに失敗しました" />
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">
          {statusFilter === 'pending' ? '未審査のコンテンツはありません' : 'コンテンツがありません'}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                      {CONTENT_TYPE_LABELS[item.content_type] || item.content_type}
                    </span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_CONFIG[item.status].className}`}>
                      {STATUS_CONFIG[item.status].label}
                    </span>
                    {item.auto_flags && item.auto_flags.length > 0 && (
                      <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                        自動フラグ: {item.auto_flags.join('、')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    {new Date(item.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                    {item.facility_name && ` | ${item.facility_name}`}
                  </p>
                  {item.report_reason && (
                    <p className="text-sm text-gray-700">通報理由: {item.report_reason}</p>
                  )}
                  <p className="text-xs font-mono text-gray-400 break-all">ID: {item.content_id}</p>
                </div>
              </div>

              {/* 審査アクション */}
              {item.status === 'pending' && (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  {reviewingId === item.id ? (
                    <>
                      <textarea
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        placeholder="審査メモ（任意）"
                        rows={2}
                        maxLength={500}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-400"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleDecision(item.id, 'approved')}
                          className="flex-1 py-2 bg-emerald-500 text-white rounded-lg text-sm font-bold hover:bg-emerald-600"
                        >
                          承認
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecision(item.id, 'rejected')}
                          className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-bold hover:bg-red-600"
                        >
                          却下
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecision(item.id, 'escalated')}
                          className="flex-1 py-2 bg-purple-500 text-white rounded-lg text-sm font-bold hover:bg-purple-600"
                        >
                          エスカレ
                        </button>
                        <button
                          type="button"
                          onClick={() => { setReviewingId(null); setReviewNote(''); }}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                        >
                          戻る
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setReviewingId(item.id)}
                      className="text-sm px-4 py-2 bg-sky-100 text-sky-700 rounded-lg hover:bg-sky-200 font-medium"
                    >
                      審査する
                    </button>
                  )}
                </div>
              )}
              {item.review_note && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1">審査メモ: {item.review_note}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

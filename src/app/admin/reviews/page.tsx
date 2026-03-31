'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import type { FacilityReview } from '@/types';

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<FacilityReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'published' | 'hidden'>('all');
  const [updating, setUpdating] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [repliesMap, setRepliesMap] = useState<Record<string, { id: string; content: string; created_at: string }[]>>({});

  const loadReviews = useCallback(async (fId: string) => {
    const supabase = createBrowserSupabaseClient();
    let query = supabase
      .from('facility_reviews')
      .select('*')
      .eq('facility_id', fId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (filter !== 'all') query = query.eq('status', filter);
    const { data } = await query;
    setReviews((data ?? []) as FacilityReview[]);
  }, [filter]);

  useEffect(() => {
    const init = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: membership } = await supabase.from('facility_members').select('facility_id').eq('user_id', user.id).limit(1).single();
      if (!membership) { setLoading(false); return; }
      setFacilityId(membership.facility_id);
      await loadReviews(membership.facility_id);
      // Load replies
      const { data: replies } = await supabase
        .from('review_replies')
        .select('id, review_id, content, created_at')
        .eq('facility_id', membership.facility_id)
        .order('created_at');
      if (replies) {
        const map: Record<string, typeof replies> = {};
        for (const r of replies) {
          if (!map[r.review_id]) map[r.review_id] = [];
          map[r.review_id].push(r);
        }
        setRepliesMap(map);
      }
      setLoading(false);
    };
    init().catch(() => setLoading(false));
  }, [loadReviews]);

  useEffect(() => {
    if (facilityId) loadReviews(facilityId);
  }, [filter, facilityId, loadReviews]);

  const toggleStatus = async (review: FacilityReview) => {
    if (!facilityId || updating) return;
    setUpdating(review.id);
    const newStatus = review.status === 'published' ? 'hidden' : 'published';
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase
        .from('facility_reviews')
        .update({ status: newStatus })
        .eq('id', review.id)
        .eq('facility_id', facilityId);
      if (error) throw error;
      setReviews((prev) => prev.map((r) => r.id === review.id ? { ...r, status: newStatus } : r));
      setToast({ type: 'success', message: newStatus === 'published' ? '公開しました' : '非表示にしました' });
    } catch {
      setToast({ type: 'error', message: '更新に失敗しました' });
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
      </div>
    );
  }

  const submitReply = async (reviewId: string) => {
    const text = replyText[reviewId]?.trim();
    if (!text || !facilityId) return;
    setReplyingTo(reviewId);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('review_replies')
        .insert({ review_id: reviewId, user_id: user.id, content: text, facility_id: facilityId })
        .select('id, content, created_at')
        .single();
      if (error) throw error;
      if (data) {
        setRepliesMap((prev) => ({
          ...prev,
          [reviewId]: [...(prev[reviewId] || []), { ...data, review_id: reviewId }],
        }));
        setReplyText((prev) => ({ ...prev, [reviewId]: '' }));
        setToast({ type: 'success', message: '返信しました' });
      }
    } catch {
      setToast({ type: 'error', message: '返信に失敗しました' });
    }
    setReplyingTo(null);
  };

  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">口コミ管理</h1>

      {/* フィルタ */}
      <div className="flex gap-2 mb-6">
        {([['all', 'すべて'], ['published', '公開中'], ['hidden', '非表示']] as const).map(([value, label]) => (
          <button
            type="button"
            key={value}
            onClick={() => setFilter(value)}
            className={`text-sm px-4 py-2 rounded-full font-bold transition-colors ${
              filter === value ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {reviews.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="text-gray-400">口コミがありません</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className={`bg-white rounded-xl shadow-sm p-5 ${review.status === 'hidden' ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-amber-400 text-sm">{stars(review.rating)}</span>
                    <span className="text-sm font-bold text-gray-700">{review.rating.toFixed(1)}</span>
                    <span className={`text-micro px-2 py-0.5 rounded-full font-bold ${
                      review.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {review.status === 'published' ? '公開中' : '非表示'}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-800">{review.reviewer_name}</p>
                  {review.comment && (
                    <p className="text-sm text-gray-600 mt-1 line-clamp-3">{review.comment}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">{new Date(review.created_at).toLocaleDateString('ja-JP')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleStatus(review)}
                  disabled={updating === review.id}
                  className={`shrink-0 text-xs px-4 py-2 rounded-lg font-bold transition-colors ${
                    review.status === 'published'
                      ? 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600'
                      : 'bg-green-50 text-green-600 hover:bg-green-100'
                  }`}
                >
                  {review.status === 'published' ? '非表示にする' : '公開する'}
                </button>
              </div>

              {/* 既存の返信 */}
              {(repliesMap[review.id] || []).map((reply) => (
                <div key={reply.id} className="mt-3 ml-4 bg-sky-50 border border-sky-100 rounded-lg p-3">
                  <span className="text-micro font-bold text-sky-600">サロンより</span>
                  <p className="text-sm text-gray-700 mt-1">{reply.content}</p>
                  <p className="text-xs text-gray-400 mt-1">{new Date(reply.created_at).toLocaleDateString('ja-JP')}</p>
                </div>
              ))}

              {/* 返信入力 */}
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  placeholder="口コミに返信する..."
                  value={replyText[review.id] || ''}
                  onChange={(e) => setReplyText((prev) => ({ ...prev, [review.id]: e.target.value }))}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-300"
                  maxLength={500}
                />
                <button
                  type="button"
                  onClick={() => submitReply(review.id)}
                  disabled={replyingTo === review.id || !(replyText[review.id]?.trim())}
                  className="shrink-0 text-xs px-4 py-2 bg-sky-500 text-white rounded-lg font-bold hover:bg-sky-600 disabled:opacity-50 transition-colors"
                >
                  返信
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}

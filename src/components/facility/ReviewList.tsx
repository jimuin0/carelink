'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import type { FacilityReview } from '@/types';
import StarRating from './StarRating';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';

interface ReviewReply {
  id: string;
  content: string;
  created_at: string;
}


function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  });
}

const AXES: { key: keyof FacilityReview; label: string }[] = [
  { key: 'rating_skill', label: '技術' },
  { key: 'rating_service', label: '接客' },
  { key: 'rating_atmosphere', label: '雰囲気' },
  { key: 'rating_cleanliness', label: '清潔感' },
  { key: 'rating_explanation', label: '説明' },
];

export default function ReviewList({ reviews }: { reviews: FacilityReview[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [repliesMap, setRepliesMap] = useState<Record<string, ReviewReply[]>>({});
  const [helpfulMap, setHelpfulMap] = useState<Record<string, number>>({});
  const [myHelpful, setMyHelpful] = useState<Set<string>>(new Set());
  const [helpfulLoading, setHelpfulLoading] = useState<string | null>(null);
  const [reportedSet, setReportedSet] = useState<Set<string>>(new Set());
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [confirmReportId, setConfirmReportId] = useState<string | null>(null);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);

  useEffect(() => {
    if (reviews.length === 0) return;
    const loadRepliesAndHelpful = async () => {
      const supabase = createBrowserSupabaseClient();
      const reviewIds = reviews.map((r) => r.id);

      // Load replies（補助エンリッチ：口コミ一覧は props 表示済み。失敗時も一覧本体は維持）
      // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
      const { data: replies } = await supabase
        .from('review_replies')
        .select('id, review_id, content, created_at')
        .in('review_id', reviewIds)
        .order('created_at');
      if (replies) {
        const map: Record<string, ReviewReply[]> = {};
        for (const r of replies) {
          if (!map[r.review_id]) map[r.review_id] = [];
          map[r.review_id].push(r);
        }
        setRepliesMap(map);
      }

      // Load helpful counts（補助エンリッチ：失敗時も一覧本体は維持）
      // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
      const { data: helpfulCounts } = await supabase
        .from('review_helpful')
        .select('review_id')
        .in('review_id', reviewIds);
      if (helpfulCounts) {
        const counts: Record<string, number> = {};
        for (const h of helpfulCounts) {
          counts[h.review_id] = (counts[h.review_id] || 0) + 1;
        }
        setHelpfulMap(counts);
      }

      // Load my helpful
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // 自分の「参考になった」状態（補助）。失敗時も一覧本体は維持
        // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
        const { data: myH } = await supabase
          .from('review_helpful')
          .select('review_id')
          .eq('user_id', user.id)
          .in('review_id', reviewIds);
        if (myH) setMyHelpful(new Set(myH.map((h) => h.review_id)));
      }
    };
    loadRepliesAndHelpful().catch(() => {});
  }, [reviews]);

  const toggleHelpful = async (reviewId: string) => {
    if (helpfulLoading) return;
    setHelpfulLoading(reviewId);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth/login');
        return;
      }
      const wasHelpful = myHelpful.has(reviewId);
      if (wasHelpful) {
        setMyHelpful((prev) => { const next = new Set(prev); next.delete(reviewId); return next; });
        setHelpfulMap((prev) => ({ ...prev, [reviewId]: (prev[reviewId] || 1) - 1 }));
        const { error } = await supabase.from('review_helpful').delete().eq('review_id', reviewId).eq('user_id', user.id);
        if (error) {
          setMyHelpful((prev) => new Set(prev).add(reviewId));
          setHelpfulMap((prev) => ({ ...prev, [reviewId]: (prev[reviewId] || 0) + 1 }));
        }
      } else {
        setMyHelpful((prev) => new Set(prev).add(reviewId));
        setHelpfulMap((prev) => ({ ...prev, [reviewId]: (prev[reviewId] || 0) + 1 }));
        const { error } = await supabase.from('review_helpful').insert({ review_id: reviewId, user_id: user.id });
        if (error) {
          setMyHelpful((prev) => { const next = new Set(prev); next.delete(reviewId); return next; });
          setHelpfulMap((prev) => ({ ...prev, [reviewId]: (prev[reviewId] || 1) - 1 }));
        }
      }
    } catch {
      // network error — revert to server state on next page load
    }
    setHelpfulLoading(null);
  };

  const handleReport = async (reviewId: string) => {
    if (reportingId || reportedSet.has(reviewId)) return;
    // 通報は要ログイン（2026年7月15日 HPB 準拠・神原さん確定）。未ログインは
    // 通報確認ダイアログでなくログイン誘導ダイアログを出す。
    const supabase = createBrowserSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setShowLoginPrompt(true);
      return;
    }
    setConfirmReportId(reviewId);
  };

  const executeReport = async () => {
    const reviewId = confirmReportId;
    if (!reviewId) return;
    setConfirmReportId(null);
    setReportingId(reviewId);
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'required' },
        body: JSON.stringify({ target_type: 'review', target_id: reviewId, reason: 'inappropriate' }),
      });
      if (res.ok) {
        setReportedSet((prev) => new Set(prev).add(reviewId));
        setToast({ type: 'success', message: '通報しました。ご協力ありがとうございます。' });
      } else if (res.status === 401) {
        // セッション失効等でクリック時チェックをすり抜けたケースの保険。
        setToast({ type: 'error', message: '通報にはログインが必要です。ログインしてからもう一度お試しください。' });
        setShowLoginPrompt(true);
      } else {
        const body = await res.json().catch(() => null);
        setToast({ type: 'error', message: body?.error || '通報に失敗しました' });
      }
    } catch {
      setToast({ type: 'error', message: '通報に失敗しました' });
    }
    setReportingId(null);
  };

  if (reviews.length === 0) {
    return (
      <p className="text-gray-400 text-center py-8">
        まだ口コミはありません。最初の口コミを投稿してみませんか？
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {reviews.map((review) => {
        const hasAxis = review.rating_skill && review.rating_skill > 0;
        const replies = repliesMap[review.id] || [];
        const helpfulCount = helpfulMap[review.id] || 0;
        const isMyHelpful = myHelpful.has(review.id);
        return (
          <div key={review.id} className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-sky-100 text-sky-600 rounded-full flex items-center justify-center text-sm font-bold">
                  {(review.reviewer_name?.trim() || 'ユ').charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-sm">{review.reviewer_name}</p>
                    {review.is_verified_visit && (
                      <span className="text-micro bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold">来店確認済み</span>
                    )}
                  </div>
                  <p className="text-gray-400 text-xs">{formatDate(review.created_at)}</p>
                </div>
              </div>
              <div className="text-right">
                <StarRating value={review.rating} readonly size="sm" />
                <p className="text-xs text-gray-400 mt-0.5">総合 {review.rating.toFixed(1)}</p>
              </div>
            </div>
            {hasAxis && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                {AXES.map(({ key, label }) => {
                  const val = review[key] as number | null;
                  return val ? (
                    <span key={key}>{label} <span className="font-bold text-gray-700">{val}</span></span>
                  ) : null;
                })}
              </div>
            )}
            {review.comment && (
              <p className="text-gray-600 text-sm leading-relaxed mt-2">{review.comment}</p>
            )}

            {/* 写真 */}
            {review.photo_urls && review.photo_urls.length > 0 && (
              <div className="flex gap-2 mt-3">
                {review.photo_urls.map((url, i) => (
                  <div key={`${review.id}-photo-${i}`} className="relative w-16 h-16 rounded-lg overflow-hidden bg-gray-200">
                    <Image src={url} alt={`${review.reviewer_name}さんの口コミ写真${i + 1}`} fill className="object-cover" sizes="64px" />
                  </div>
                ))}
              </div>
            )}

            {/* 役に立った + 通報 */}
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => toggleHelpful(review.id)}
                disabled={helpfulLoading === review.id}
                className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full transition-colors ${
                  isMyHelpful ? 'bg-sky-100 text-sky-600 font-bold' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill={isMyHelpful ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                </svg>
                役に立った{helpfulCount > 0 ? ` (${helpfulCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => handleReport(review.id)}
                disabled={reportingId === review.id || reportedSet.has(review.id)}
                className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors ml-auto"
                aria-label="この口コミを通報する"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                </svg>
                {reportedSet.has(review.id) ? '通報済み' : '通報'}
              </button>
            </div>

            {/* サロン返信 */}
            {replies.map((reply) => (
              <div key={reply.id} className="mt-3 ml-4 bg-white border border-gray-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-micro font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full">サロンより</span>
                  <span className="text-xs text-gray-400">{formatDate(reply.created_at)}</span>
                </div>
                <p className="text-sm text-gray-600">{reply.content}</p>
              </div>
            ))}
          </div>
        );
      })}
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={confirmReportId !== null}
        title="口コミを通報"
        message="この口コミを不正・不適切として通報しますか？"
        confirmLabel="通報する"
        cancelLabel="キャンセル"
        onConfirm={executeReport}
        onCancel={() => setConfirmReportId(null)}
      />
      <ConfirmDialog
        open={showLoginPrompt}
        title="ログインが必要です"
        message="通報にはログインが必要です。ログインしてからもう一度お試しください。"
        confirmLabel="ログインする"
        cancelLabel="キャンセル"
        onConfirm={() => {
          setShowLoginPrompt(false);
          router.push(`/auth/login?redirect=${encodeURIComponent(pathname)}`);
        }}
        onCancel={() => setShowLoginPrompt(false)}
      />
    </div>
  );
}

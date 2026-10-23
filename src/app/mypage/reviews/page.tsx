'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import AdminPageLoading from '@/components/admin/AdminPageLoading';
import type { MyReview } from '@/lib/my-reviews';

// 運営の審査で止められている口コミは、本人が「公開中」と思い込まないよう理由を添えて示す（2026年10月23日）。
// 以前は status だけを見ており、審査中・運営判断で非公開の口コミにも何も出なかった。
const MODERATION_LABEL = {
  pending: '運営の確認中のため、まだ公開されていません',
  rejected: '運営の判断で非公開になっています',
  stalled: '公開の手続きが止まっています。お手数ですが、運営までお問い合わせください',
} as const;

export default function MyReviewsPage() {
  const [reviews, setReviews] = useState<MyReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // reload 相当の処理は「マウント時の初回読み込み」と「読み込み失敗後の再試行」の2箇所からしか
  // 呼ばれず、どちらも同じ処理を求める呼び出しなので、reloadKey を effect の依存に置いて
  // 再試行時はキーをインクリメントするだけにする（処理本体は effect 内に1箇所だけ inline する）。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadError(false);
        // 本人の口コミはサーバーが本人の行だけを読んで返す（2026年10月23日）。投稿者のアカウント ID を
        // 店舗に見せないよう、ブラウザから user_id 列で絞り込む読み方はできなくした（migration 20261023120100）。
        const res = await fetch('/api/review/mine', { cache: 'no-store' });
        const body: unknown = await res.json().catch(() => null);
        const list = res.ok && body !== null && typeof body === 'object' ? (body as { reviews?: unknown }).reviews : undefined;
        if (cancelled) return;
        if (!Array.isArray(list)) { setLoadError(true); setLoading(false); return; }
        setReviews(list as MyReview[]);
        setLoading(false);
      } catch {
        if (!cancelled) { setLoadError(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/review/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setToast({ type: 'error', message: e.error || '削除に失敗しました' });
        return;
      }
      setReviews((prev) => prev.filter((r) => r.id !== id));
      setToast({ type: 'success', message: '口コミを削除しました' });
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <AdminPageLoading />;
  if (loadError) return <LoadError onRetry={() => { setLoading(true); setReloadKey((k) => k + 1); }} />;

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">投稿した口コミ</h1>

      {reviews.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-xs p-8 text-center">
          <p className="text-gray-500">投稿した口コミがありません</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="bg-white rounded-2xl shadow-xs p-6">
              <div className="flex items-start justify-between">
                <div>
                  <Link href={`/facility/${review.facility_slug}`} className="font-bold text-primary hover:underline">
                    {review.facility_name}
                  </Link>
                  <p className="text-sm text-gray-500 mt-1">
                    {review.created_at ? new Date(review.created_at).toLocaleDateString('ja-JP') : ''}
                    {review.moderation === 'none' && review.status === 'hidden' && <span className="ml-2 text-amber-700">(非表示中)</span>}
                  </p>
                  {review.moderation !== 'none' && (
                    <p className="text-sm text-amber-800 mt-1">{MODERATION_LABEL[review.moderation]}</p>
                  )}
                </div>
                <div className="text-lg font-bold text-amber-500">★{review.rating}</div>
              </div>
              {review.comment && <p className="text-sm text-gray-700 mt-3 whitespace-pre-wrap">{review.comment}</p>}
              <div className="flex gap-3 mt-4">
                <Link href={`/mypage/reviews/${review.id}/edit`} className="text-sm text-primary hover:underline">
                  編集
                </Link>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(review.id)}
                  disabled={deletingId === review.id}
                  className="text-sm text-red-600 hover:underline"
                >
                  {deletingId === review.id ? '削除中...' : '削除'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="口コミを削除"
        message="この口コミを削除しますか？この操作は取り消せません。"
        confirmLabel="削除する"
        variant="danger"
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}

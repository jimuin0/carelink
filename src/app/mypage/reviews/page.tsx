'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import AdminPageLoading from '@/components/admin/AdminPageLoading';
import type { FacilityReview } from '@/types';

interface ReviewWithFacility extends FacilityReview {
  facility_name: string;
  facility_slug: string;
}

export default function MyReviewsPage() {
  const [reviews, setReviews] = useState<ReviewWithFacility[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoadError(false);
    const supabase = createBrowserSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data, error } = await supabase
      .from('facility_reviews')
      .select('*, facility_profiles(name, slug)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) { setLoadError(true); setLoading(false); return; }

    const list = (data ?? []).map((r) => {
      const facility = (r as unknown as { facility_profiles: { name: string; slug: string } | null }).facility_profiles;
      return {
        ...(r as unknown as FacilityReview),
        facility_name: facility?.name ?? '不明な施設',
        facility_slug: facility?.slug ?? '',
      };
    });
    setReviews(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload().catch(() => { setLoadError(true); setLoading(false); });
  }, [reload]);

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
  if (loadError) return <LoadError onRetry={() => { setLoading(true); reload(); }} />;

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">投稿した口コミ</h1>

      {reviews.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
          <p className="text-gray-400">投稿した口コミがありません</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="bg-white rounded-2xl shadow-sm p-6">
              <div className="flex items-start justify-between">
                <div>
                  <Link href={`/facility/${review.facility_slug}`} className="font-bold text-primary hover:underline">
                    {review.facility_name}
                  </Link>
                  <p className="text-sm text-gray-400 mt-1">
                    {new Date(review.created_at).toLocaleDateString('ja-JP')}
                    {review.status === 'hidden' && <span className="ml-2 text-amber-600">(非表示中)</span>}
                  </p>
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

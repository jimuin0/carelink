'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import StarRating from '@/components/facility/StarRating';
import AdminPageLoading from '@/components/admin/AdminPageLoading';
import LoadError from '@/components/admin/LoadError';

const AXES = [
  { key: 'rating_skill', label: '技術' },
  { key: 'rating_service', label: '接客' },
  { key: 'rating_atmosphere', label: '雰囲気' },
  { key: 'rating_cleanliness', label: '清潔感' },
  { key: 'rating_explanation', label: '施術の説明' },
] as const;

type AxisKey = (typeof AXES)[number]['key'];

export default function EditReviewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [ratings, setRatings] = useState<Record<AxisKey, number>>({
    rating_skill: 0,
    rating_service: 0,
    rating_atmosphere: 0,
    rating_cleanliness: 0,
    rating_explanation: 0,
  });
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoadError(true); setLoading(false); return; }

      const { data, error } = await supabase
        .from('facility_reviews')
        .select('*')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single();

      if (error || !data) { setLoadError(true); setLoading(false); return; }

      setRatings({
        rating_skill: data.rating_skill ?? data.rating,
        rating_service: data.rating_service ?? data.rating,
        rating_atmosphere: data.rating_atmosphere ?? data.rating,
        rating_cleanliness: data.rating_cleanliness ?? data.rating,
        rating_explanation: data.rating_explanation ?? data.rating,
      });
      setComment(data.comment ?? '');
      setLoading(false);
    })();
  }, [params.id]);

  const handleSave = async () => {
    if (saving) return;
    if (Object.values(ratings).some((v) => v < 1)) {
      setToast({ type: 'error', message: '全ての評価項目を選択してください' });
      return;
    }
    setSaving(true);

    const res = await fetch(`/api/review/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ratings, comment: comment || null }),
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setToast({ type: 'error', message: e.error || '更新に失敗しました' });
      setSaving(false);
    } else {
      router.push('/mypage/reviews');
    }
  };

  if (loading) return <AdminPageLoading />;
  if (loadError) return <LoadError onRetry={() => window.location.reload()} />;

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">口コミを編集</h1>

      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
        {AXES.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-sm text-gray-700">{label}</span>
            <StarRating value={ratings[key]} onChange={(v) => setRatings((prev) => ({ ...prev, [key]: v }))} />
          </div>
        ))}

        <div>
          <label htmlFor="review-comment" className="form-label">コメント</label>
          <textarea
            id="review-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="form-input"
            rows={4}
            maxLength={500}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.push('/mypage/reviews')} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex-1 !py-3">
            {saving ? '保存中...' : '更新する'}
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}

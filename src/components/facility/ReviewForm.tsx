'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import StarRating from './StarRating';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

const MAX_PHOTOS = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const ratingAxis = z.number().min(1, '評価を選択してください').max(5);

const reviewSchema = z.object({
  reviewer_name: z.string().min(1, 'お名前を入力してください'),
  rating_skill: ratingAxis,
  rating_service: ratingAxis,
  rating_atmosphere: ratingAxis,
  rating_cleanliness: ratingAxis,
  rating_explanation: ratingAxis,
  comment: z.string().max(500, '500文字以内で入力してください').optional().or(z.literal('')),
});

type ReviewFormData = z.infer<typeof reviewSchema>;

const AXES = [
  { key: 'rating_skill', label: '技術' },
  { key: 'rating_service', label: '接客' },
  { key: 'rating_atmosphere', label: '雰囲気' },
  { key: 'rating_cleanliness', label: '清潔感' },
  { key: 'rating_explanation', label: '施術の説明' },
] as const;

interface Props {
  facilityId: string;
  onReviewSubmitted: () => void;
}

export default function ReviewForm({ facilityId, onReviewSubmitted }: Props) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting, isDirty }, reset } = useForm<ReviewFormData>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      reviewer_name: '',
      rating_skill: 0,
      rating_service: 0,
      rating_atmosphere: 0,
      rating_cleanliness: 0,
      rating_explanation: 0,
      comment: '',
    },
  });

  useEffect(() => {
    if ((!isDirty && photos.length === 0) || submitted) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, photos.length, submitted]);

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => { photoPreviews.forEach((url) => URL.revokeObjectURL(url)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    let hasTypeError = false;
    let hasSizeError = false;
    const valid = files.filter((f) => {
      if (!ALLOWED_TYPES.includes(f.type)) { hasTypeError = true; return false; }
      if (f.size > MAX_FILE_SIZE) { hasSizeError = true; return false; }
      return true;
    });
    if (hasTypeError) setToast({ type: 'error', message: 'JPEG/PNG/WebPのみ対応です' });
    else if (hasSizeError) setToast({ type: 'error', message: '5MB以下の画像を選択してください' });
    const combined = [...photos, ...valid].slice(0, MAX_PHOTOS);
    setPhotos(combined);
    setPhotoPreviews(combined.map((f) => URL.createObjectURL(f)));
    e.target.value = '';
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photoPreviews[index]);
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const onSubmit = async (data: ReviewFormData) => {
    const sb = createBrowserSupabaseClient();

    // Rate limit: 1 review per facility per 24h
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await sb
        .from('facility_reviews')
        .select('id')
        .eq('facility_id', facilityId)
        .eq('user_id', user.id)
        .gte('created_at', since)
        .limit(1);
      if (recent && recent.length > 0) {
        setToast({ type: 'error', message: '同じ施設への口コミは24時間に1回までです' });
        return;
      }
    }

    const avg = Math.round(
      (data.rating_skill + data.rating_service + data.rating_atmosphere + data.rating_cleanliness + data.rating_explanation) / 5
    );

    try {
      // Check verified visit
      let isVerifiedVisit = false;
      if (user) {
        const { data: completedBooking } = await sb
          .from('bookings')
          .select('id')
          .eq('facility_id', facilityId)
          .eq('user_id', user.id)
          .eq('status', 'completed')
          .limit(1);
        isVerifiedVisit = (completedBooking?.length ?? 0) > 0;
      }

      // Upload photos
      const photo_urls: string[] = [];
      if (photos.length > 0) {
        for (const file of photos) {
          const ext = file.name.split('.').pop() || 'jpg';
          const path = `reviews/${facilityId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: uploadErr } = await sb.storage.from('review-photos').upload(path, file);
          if (!uploadErr) {
            const { data: urlData } = sb.storage.from('review-photos').getPublicUrl(path);
            photo_urls.push(urlData.publicUrl);
          }
        }
      }

      const { error } = await sb.from('facility_reviews').insert({
        facility_id: facilityId,
        reviewer_name: data.reviewer_name,
        rating: avg,
        rating_skill: data.rating_skill,
        rating_service: data.rating_service,
        rating_atmosphere: data.rating_atmosphere,
        rating_cleanliness: data.rating_cleanliness,
        rating_explanation: data.rating_explanation,
        comment: data.comment || null,
        photo_urls: photo_urls.length > 0 ? photo_urls : null,
        ...(user ? { user_id: user.id, is_verified_visit: isVerifiedVisit } : {}),
      });
      if (error) throw error;

      setSubmitted(true);
      setPhotos([]);
      photoPreviews.forEach((url) => URL.revokeObjectURL(url));
      setPhotoPreviews([]);
      reset();
      onReviewSubmitted();
      setToast({ type: 'success', message: '口コミを投稿しました' });
    } catch {
      setToast({ type: 'error', message: '送信に失敗しました。もう一度お試しください。' });
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-8">
        <p className="text-lg font-bold mb-2">口コミを投稿しました</p>
        <p className="text-gray-500 text-sm mb-4">ご投稿ありがとうございます。</p>
        <button onClick={() => router.refresh()} className="text-sky-600 text-sm hover:underline">
          ページを更新する
        </button>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit(() => setShowConfirm(true))} noValidate className="space-y-4">
        <div>
          <label htmlFor="reviewer_name" className="form-label">お名前 <span className="text-red-500">*</span></label>
          <input {...register('reviewer_name')} id="reviewer_name" className="form-input" placeholder="ニックネーム可" autoComplete="name" />
          {errors.reviewer_name && <p className="form-error" role="alert">{errors.reviewer_name.message}</p>}
        </div>

        <div>
          <p className="form-label">評価 <span className="text-red-500">*</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {AXES.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-gray-700 min-w-[5em]">{label}</span>
                <StarRating value={watch(key)} onChange={(v) => setValue(key, v, { shouldValidate: true })} size="sm" />
              </div>
            ))}
          </div>
          {(errors.rating_skill || errors.rating_service || errors.rating_atmosphere || errors.rating_cleanliness || errors.rating_explanation) && (
            <p className="form-error mt-1" role="alert">すべての項目を評価してください</p>
          )}
        </div>

        <div>
          <label htmlFor="review_comment" className="form-label">コメント</label>
          <textarea {...register('comment')} id="review_comment" className="form-input" rows={3} placeholder="ご感想をお聞かせください（500文字以内）" />
          {errors.comment && <p className="form-error" role="alert">{errors.comment.message}</p>}
        </div>

        <div>
          <p className="form-label">写真（最大3枚）</p>
          <div className="flex gap-2 flex-wrap">
            {photoPreviews.map((url, i) => (
              <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`口コミ投稿用プレビュー写真${i + 1}`} className="w-full h-full object-cover" />
                <button type="button" onClick={() => removePhoto(i)} aria-label={`写真${i + 1}を削除`} className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full text-xs flex items-center justify-center">
                  ×
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <label className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-sky-400 transition-colors" aria-label="写真を追加">
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} className="hidden" aria-label="口コミ写真を選択" />
              </label>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">JPEG/PNG/WebP・5MB以下</p>
        </div>

        <button type="submit" disabled={isSubmitting} className="btn-primary w-full !py-3 text-sm">
          {isSubmitting ? '送信中...' : '口コミを投稿する'}
        </button>
      </form>

      <ConfirmDialog
        open={showConfirm}
        title="口コミを投稿しますか？"
        message="投稿後の編集・削除はできません。"
        confirmLabel="投稿する"
        cancelLabel="戻る"
        onConfirm={() => { if (isSubmitting) return; setShowConfirm(false); handleSubmit(onSubmit)(); }}
        onCancel={() => setShowConfirm(false)}
      />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </>
  );
}

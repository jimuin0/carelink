'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import StarRating from './StarRating';

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

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting }, reset } = useForm<ReviewFormData>({
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

  const onSubmit = async (data: ReviewFormData) => {
    const avg = Math.round(
      (data.rating_skill + data.rating_service + data.rating_atmosphere + data.rating_cleanliness + data.rating_explanation) / 5
    );

    try {
      const { error } = await supabase.from('facility_reviews').insert({
        facility_id: facilityId,
        reviewer_name: data.reviewer_name,
        rating: avg,
        rating_skill: data.rating_skill,
        rating_service: data.rating_service,
        rating_atmosphere: data.rating_atmosphere,
        rating_cleanliness: data.rating_cleanliness,
        rating_explanation: data.rating_explanation,
        comment: data.comment || null,
      });
      if (error) throw error;

      setSubmitted(true);
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

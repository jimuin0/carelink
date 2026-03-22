'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import StarRating from './StarRating';

const reviewSchema = z.object({
  reviewer_name: z.string().min(1, 'お名前を入力してください'),
  rating: z.number().min(1, '評価を選択してください').max(5),
  comment: z.string().max(500, '500文字以内で入力してください').optional().or(z.literal('')),
});

type ReviewFormData = z.infer<typeof reviewSchema>;

interface Props {
  facilityId: string;
  onReviewSubmitted: () => void;
}

export default function ReviewForm({ facilityId, onReviewSubmitted }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting }, reset } = useForm<ReviewFormData>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { reviewer_name: '', rating: 0, comment: '' },
  });

  const rating = watch('rating');

  const onSubmit = async (data: ReviewFormData) => {
    try {
      const { error } = await supabase.from('facility_reviews').insert({
        facility_id: facilityId,
        reviewer_name: data.reviewer_name,
        rating: data.rating,
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
        <button onClick={() => setSubmitted(false)} className="text-sky-600 text-sm hover:underline">
          もう一件投稿する
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
          {errors.reviewer_name && <p className="form-error">{errors.reviewer_name.message}</p>}
        </div>

        <div>
          <label className="form-label" id="rating-label">評価 <span className="text-red-500">*</span></label>
          <div aria-labelledby="rating-label">
            <StarRating value={rating} onChange={(v) => setValue('rating', v, { shouldValidate: true })} />
          </div>
          {errors.rating && <p className="form-error">{errors.rating.message}</p>}
        </div>

        <div>
          <label htmlFor="review_comment" className="form-label">コメント</label>
          <textarea {...register('comment')} id="review_comment" className="form-input" rows={3} placeholder="ご感想をお聞かせください（500文字以内）" />
          {errors.comment && <p className="form-error">{errors.comment.message}</p>}
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
        onConfirm={() => { setShowConfirm(false); handleSubmit(onSubmit)(); }}
        onCancel={() => setShowConfirm(false)}
      />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </>
  );
}

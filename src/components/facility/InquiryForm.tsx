'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';

const inquirySchema = z.object({
  name: z.string().min(1, 'お名前を入力してください'),
  email: z.string().email('正しいメールアドレスを入力してください'),
  phone: z.string().optional().or(z.literal('')),
  message: z.string().min(1, 'お問い合わせ内容を入力してください').max(1000, '1000文字以内で入力してください'),
});

type InquiryFormData = z.infer<typeof inquirySchema>;

interface Props {
  facilityId: string;
  facilityName: string;
}

export default function InquiryForm({ facilityId, facilityName }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<InquiryFormData>({
    resolver: zodResolver(inquirySchema),
    defaultValues: { name: '', email: '', phone: '', message: '' },
  });

  const onSubmit = async (data: InquiryFormData) => {
    try {
      const { error } = await supabase.from('facility_inquiries').insert({
        facility_id: facilityId,
        facility_name: facilityName,
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        message: data.message,
      });
      if (error) throw error;

      // Slack notification (fire-and-forget)
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'facility_inquiry',
          data: {
            facility_name: facilityName,
            name: data.name,
            email: data.email,
            phone: data.phone || '未入力',
            message: data.message,
          },
        }),
      }).catch(() => {});

      setSubmitted(true);
      reset();
      setToast({ type: 'success', message: 'お問い合わせを送信しました' });
    } catch {
      setToast({ type: 'error', message: '送信に失敗しました。もう一度お試しください。' });
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-8">
        <p className="text-lg font-bold mb-2">お問い合わせを送信しました</p>
        <p className="text-gray-500 text-sm mb-4">担当者より折り返しご連絡いたします。</p>
        <button onClick={() => setSubmitted(false)} className="text-sky-600 text-sm hover:underline">
          別のお問い合わせをする
        </button>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit(() => setShowConfirm(true))} noValidate className="space-y-4">
        <div>
          <label htmlFor="inquiry_name" className="form-label">お名前 <span className="text-red-500">*</span></label>
          <input {...register('name')} id="inquiry_name" className="form-input" placeholder="山田 太郎" autoComplete="name" />
          {errors.name && <p className="form-error">{errors.name.message}</p>}
        </div>

        <div>
          <label htmlFor="inquiry_email" className="form-label">メールアドレス <span className="text-red-500">*</span></label>
          <input {...register('email')} id="inquiry_email" type="email" className="form-input" placeholder="example@email.com" autoComplete="email" />
          {errors.email && <p className="form-error">{errors.email.message}</p>}
        </div>

        <div>
          <label htmlFor="inquiry_phone" className="form-label">電話番号</label>
          <input {...register('phone')} id="inquiry_phone" type="tel" className="form-input" placeholder="090-1234-5678" autoComplete="tel" />
        </div>

        <div>
          <label htmlFor="inquiry_message" className="form-label">お問い合わせ内容 <span className="text-red-500">*</span></label>
          <textarea {...register('message')} id="inquiry_message" className="form-input" rows={4} placeholder="ご予約・ご質問などお気軽にお書きください（1000文字以内）" />
          {errors.message && <p className="form-error">{errors.message.message}</p>}
        </div>

        <button type="submit" disabled={isSubmitting} className="btn-primary w-full !py-3 text-sm">
          {isSubmitting ? '送信中...' : 'お問い合わせを送信する'}
        </button>
      </form>

      <ConfirmDialog
        open={showConfirm}
        title="お問い合わせを送信しますか？"
        message="入力内容を確認のうえ、送信してください。"
        confirmLabel="送信する"
        cancelLabel="戻る"
        onConfirm={() => { if (isSubmitting) return; setShowConfirm(false); handleSubmit(onSubmit)(); }}
        onCancel={() => setShowConfirm(false)}
      />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </>
  );
}

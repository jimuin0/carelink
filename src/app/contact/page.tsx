'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import Spinner from '@/components/Spinner';
import Toast from '@/components/Toast';

const contactSchema = z.object({
  name: z.string().min(1, 'お名前を入力してください'),
  email: z.string().email('正しいメールアドレスを入力してください'),
  inquiry_type: z.string().min(1, 'お問い合わせ種別を選択してください'),
  message: z.string().min(1, '内容を入力してください'),
});

type ContactForm = z.infer<typeof contactSchema>;

export default function ContactPage() {
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactForm>({
    resolver: zodResolver(contactSchema),
  });

  const onSubmit = async (data: ContactForm) => {
    setSubmitting(true);
    try {
      const { error } = await supabase.from('contacts').insert(data);
      if (error) throw error;
      setToast({ message: 'お問い合わせを受け付けました。2営業日以内にご返信いたします。', type: 'success' });
      reset();
    } catch {
      setToast({ message: '送信に失敗しました。時間をおいて再度お試しください。', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="section-container">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-4">お問い合わせ</h1>
        <p className="text-gray-600 text-center mb-10">
          ご質問やご不明点がございましたら、お気軽にお問い合わせください。
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div>
            <label className="form-label">
              お名前 <span className="text-red-500">*</span>
            </label>
            <input {...register('name')} className="form-input" placeholder="山田 太郎" />
            {errors.name && <p className="form-error">{errors.name.message}</p>}
          </div>

          <div>
            <label className="form-label">
              メールアドレス <span className="text-red-500">*</span>
            </label>
            <input
              {...register('email')}
              type="email"
              className="form-input"
              placeholder="example@email.com"
            />
            {errors.email && <p className="form-error">{errors.email.message}</p>}
          </div>

          <div>
            <label className="form-label">
              お問い合わせ種別 <span className="text-red-500">*</span>
            </label>
            <select {...register('inquiry_type')} className="form-input">
              <option value="">選択してください</option>
              <option value="掲載について">掲載について</option>
              <option value="求職について">求職について</option>
              <option value="その他">その他</option>
            </select>
            {errors.inquiry_type && <p className="form-error">{errors.inquiry_type.message}</p>}
          </div>

          <div>
            <label className="form-label">
              内容 <span className="text-red-500">*</span>
            </label>
            <textarea
              {...register('message')}
              className="form-input min-h-[150px]"
              placeholder="お問い合わせ内容をご記入ください"
            />
            {errors.message && <p className="form-error">{errors.message.message}</p>}
          </div>

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? (
              <span className="flex items-center gap-2">
                <Spinner />
                送信中...
              </span>
            ) : (
              '送信する'
            )}
          </button>
        </form>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

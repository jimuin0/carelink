'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import Spinner from '@/components/Spinner';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';

const contactSchema = z.object({
  name: z.string().min(1, 'お名前を入力してください'),
  email: z.string().email('正しいメールアドレスを入力してください'),
  phone: z.string().regex(/^$|^0\d{1,4}-?\d{1,4}-?\d{3,4}$/, '正しい電話番号を入力してください').optional().or(z.literal('')),
  inquiry_type: z.string().min(1, 'お問い合わせ種別を選択してください'),
  message: z.string().min(1, '内容を入力してください'),
});

type ContactForm = z.infer<typeof contactSchema>;

export default function ContactPage() {
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactForm>({
    resolver: zodResolver(contactSchema),
  });

  const handleConfirmSubmit = () => {
    setShowConfirm(false);
    handleSubmit(onSubmit)();
  };

  const onSubmit = async (data: ContactForm) => {
    setSubmitting(true);
    try {
      const { error } = await supabase.from('contacts').insert(data);
      if (error) throw error;

      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          type: 'contact',
          data: {
            name: data.name,
            inquiry_type: data.inquiry_type,
            email: data.email,
            message: data.message,
          },
        }),
      }).catch(() => {});

      reset();
      setSubmitted(true);
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

        {submitted ? (
          <div className="card text-center py-12">
            <div className="text-5xl mb-4">&#9993;</div>
            <h3 className="text-2xl font-bold mb-3">送信が完了しました</h3>
            <p className="text-gray-600 mb-8">
              お問い合わせありがとうございます。<br />
              2営業日以内にご返信いたします。
            </p>
            <Link href="/" className="btn-primary">
              トップページへ戻る
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(() => setShowConfirm(true))} className="space-y-6">
            <div>
              <label htmlFor="contact-name" className="form-label">
                お名前 <span className="text-red-500">*</span>
              </label>
              <input id="contact-name" {...register('name')} className="form-input" placeholder="山田 太郎" />
              {errors.name && <p className="form-error">{errors.name.message}</p>}
            </div>

            <div>
              <label htmlFor="contact-email" className="form-label">
                メールアドレス <span className="text-red-500">*</span>
              </label>
              <input
                id="contact-email"
                {...register('email')}
                type="email"
                className="form-input"
                placeholder="example@email.com"
              />
              {errors.email && <p className="form-error">{errors.email.message}</p>}
            </div>

            <div>
              <label htmlFor="contact-phone" className="form-label">電話番号</label>
              <input
                id="contact-phone"
                {...register('phone')}
                type="tel"
                className="form-input"
                placeholder="090-1234-5678"
              />
            </div>

            <div>
              <label htmlFor="contact-inquiry-type" className="form-label">
                お問い合わせ種別 <span className="text-red-500">*</span>
              </label>
              <select id="contact-inquiry-type" {...register('inquiry_type')} className="form-input">
                <option value="">選択してください</option>
                <option value="掲載について">掲載について</option>
                <option value="求職について">求職について</option>
                <option value="その他">その他</option>
              </select>
              {errors.inquiry_type && <p className="form-error">{errors.inquiry_type.message}</p>}
            </div>

            <div>
              <label htmlFor="contact-message" className="form-label">
                内容 <span className="text-red-500">*</span>
              </label>
              <textarea
                id="contact-message"
                {...register('message')}
                className="form-input min-h-[150px]"
                placeholder="お問い合わせ内容をご記入ください"
              />
              {errors.message && <p className="form-error">{errors.message.message}</p>}
            </div>

            <label className="flex items-start gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 rounded border-gray-300"
              />
              <span>
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline">プライバシーポリシー</a>
                に同意する
              </span>
            </label>

            <button type="submit" disabled={submitting || !agreed} className="btn-primary w-full">
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner />
                  送信中...
                </span>
              ) : (
                '送信する'
              )}
            </button>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={showConfirm}
        title="送信内容の確認"
        message="お問い合わせ内容を送信します。よろしいですか？"
        confirmLabel="送信する"
        onConfirm={handleConfirmSubmit}
        onCancel={() => setShowConfirm(false)}
      />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

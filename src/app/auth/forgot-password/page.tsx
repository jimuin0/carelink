'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { z } from 'zod';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';

const schema = z.object({
  email: z.string().email('正しいメールアドレスを入力してください'),
});
type FormData = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    if (error) {
      setToast({ type: 'error', message: 'メール送信に失敗しました。時間をおいて再度お試しください。' });
      return;
    }

    setSent(true);
  };

  if (sent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold mb-3">メールを送信しました</h1>
            <p className="text-gray-600 text-sm mb-4">
              パスワードリセット用のリンクをメールアドレスに送信しました。
              メール内のリンクから新しいパスワードを設定してください。
            </p>
            {/* 再設定リンクは申請したブラウザでしか使えない（PKCE の確認情報がこのブラウザにだけ保存される）。
                しかもメールのリンクは一度開いた時点で使用済みになるため、別のブラウザで開いてしまった後に
                同じリンクを貼り直しても通らない。開く前にコピーしてもらうよう案内する。 */}
            <div className="rounded-lg bg-gray-100 px-4 py-3 text-sm text-gray-700 text-left mb-6">
              <p className="font-bold text-gray-900">リンクは、このページを開いているのと同じブラウザで開いてください。</p>
              <p className="mt-1">
                別のブラウザやメールアプリ内のブラウザで開くと、パスワードを再設定できません。
                メールアプリ内のブラウザで開かれてしまう場合は、リンクをタップせずに長押しでコピーし、このブラウザのアドレス欄に貼り付けてください。
              </p>
              <p className="mt-1">メールのリンクは一度開くと使えなくなります。</p>
            </div>
            <Link href="/auth/login" className="text-sky-700 hover:underline text-sm">
              ログインページに戻る
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-center mb-2">パスワードをお忘れの方</h1>
          <p className="text-gray-500 text-sm text-center mb-8">
            登録済みのメールアドレスを入力してください。パスワードリセット用のリンクをお送りします。
          </p>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div>
              <label htmlFor="reset-email" className="form-label">メールアドレス</label>
              <input
                {...register('email')}
                id="reset-email"
                type="email"
                className="form-input"
                placeholder="example@email.com"
                autoComplete="email"
                aria-required="true"
              />
              {errors.email && <p className="form-error" role="alert">{errors.email.message}</p>}
            </div>

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3!">
              {isSubmitting ? '送信中...' : 'リセットメールを送信'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link href="/auth/login" className="text-sm text-gray-500 hover:underline">
              ログインページに戻る
            </Link>
          </div>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}

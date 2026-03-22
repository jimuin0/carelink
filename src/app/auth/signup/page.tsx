'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { signupSchema, type SignupFormData } from '@/lib/validations-auth';
import Toast from '@/components/Toast';

export default function SignupPage() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/mypage';
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
  });

  const onSubmit = async (data: SignupFormData) => {
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: { display_name: data.display_name },
        emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
      },
    });

    if (error) {
      if (error.message.includes('already registered')) {
        setToast({ type: 'error', message: 'このメールアドレスは既に登録されています' });
      } else {
        setToast({ type: 'error', message: '登録に失敗しました。もう一度お試しください。' });
      }
      return;
    }

    setToast({ type: 'success', message: '確認メールを送信しました。メールのリンクをクリックして登録を完了してください。' });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-center mb-8">新規登録</h1>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div>
              <label htmlFor="signup-name" className="form-label">お名前 <span className="text-red-500">*</span></label>
              <input
                {...register('display_name')}
                id="signup-name"
                className="form-input"
                placeholder="山田 太郎"
                autoComplete="name"
              />
              {errors.display_name && <p className="form-error">{errors.display_name.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-email" className="form-label">メールアドレス <span className="text-red-500">*</span></label>
              <input
                {...register('email')}
                id="signup-email"
                type="email"
                className="form-input"
                placeholder="example@email.com"
                autoComplete="email"
              />
              {errors.email && <p className="form-error">{errors.email.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-password" className="form-label">パスワード <span className="text-red-500">*</span></label>
              <input
                {...register('password')}
                id="signup-password"
                type="password"
                className="form-input"
                placeholder="8文字以上"
                autoComplete="new-password"
              />
              {errors.password && <p className="form-error">{errors.password.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-password-confirm" className="form-label">パスワード（確認） <span className="text-red-500">*</span></label>
              <input
                {...register('password_confirm')}
                id="signup-password-confirm"
                type="password"
                className="form-input"
                placeholder="もう一度入力"
                autoComplete="new-password"
              />
              {errors.password_confirm && <p className="form-error">{errors.password_confirm.message}</p>}
            </div>

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full !py-3">
              {isSubmitting ? '登録中...' : '新規登録'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              アカウントをお持ちの方は
              <Link href={`/auth/login?redirect=${encodeURIComponent(redirect)}`} className="text-sky-600 hover:underline ml-1">
                ログイン
              </Link>
            </p>
          </div>

          <div className="mt-4 text-center">
            <Link href="/search" className="text-sm text-gray-400 hover:underline">
              施設を探す
            </Link>
          </div>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}

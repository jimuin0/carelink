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
  const rawRedirect = searchParams.get('redirect') || '/mypage';
  const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/mypage';
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
              {errors.display_name && <p className="form-error" role="alert">{errors.display_name.message}</p>}
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
              {errors.email && <p className="form-error" role="alert">{errors.email.message}</p>}
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
              {errors.password && <p className="form-error" role="alert">{errors.password.message}</p>}
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
              {errors.password_confirm && <p className="form-error" role="alert">{errors.password_confirm.message}</p>}
            </div>

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full !py-3">
              {isSubmitting ? '登録中...' : '新規登録'}
            </button>
          </form>

          <div className="my-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-4 text-gray-400">または</span>
              </div>
            </div>
          </div>

          <a
            href={`/api/auth/line?redirect=${encodeURIComponent(redirect)}`}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-lg text-white font-bold hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#06C755' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 10.304C24 4.612 18.624.11 12 .11S0 4.612 0 10.304c0 5.04 4.47 9.262 10.51 10.058.41.088.968.27 1.11.618.126.316.082.81.04 1.129l-.18 1.068c-.054.33-.252 1.286 1.126.701 1.378-.585 7.438-4.382 10.148-7.502C24.648 14.312 24 12.392 24 10.304" />
            </svg>
            LINEで登録
          </a>

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

'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { loginSchema, type LoginFormData } from '@/lib/validations-auth';
import Toast from '@/components/Toast';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawRedirect = searchParams.get('redirect') || '/mypage';
  const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/mypage';
  const errorParam = searchParams.get('error');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(
    errorParam?.startsWith('line_')
      ? { type: 'error', message: 'LINEログインに失敗しました。もう一度お試しください。' }
      : null
  );

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      setToast({ type: 'error', message: 'メールアドレスまたはパスワードが正しくありません' });
      return;
    }

    router.push(redirect);
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-center mb-8">ログイン</h1>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div>
              <label htmlFor="login-email" className="form-label">メールアドレス</label>
              <input
                {...register('email')}
                id="login-email"
                type="email"
                className="form-input"
                placeholder="example@email.com"
                autoComplete="email"
              />
              {errors.email && <p className="form-error" role="alert">{errors.email.message}</p>}
            </div>

            <div>
              <label htmlFor="login-password" className="form-label">パスワード</label>
              <input
                {...register('password')}
                id="login-password"
                type="password"
                className="form-input"
                placeholder="8文字以上"
                autoComplete="current-password"
              />
              {errors.password && <p className="form-error" role="alert">{errors.password.message}</p>}
            </div>

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full !py-3">
              {isSubmitting ? 'ログイン中...' : 'ログイン'}
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
            LINEでログイン
          </a>

          <div className="mt-4 text-center">
            <Link href="/auth/forgot-password" className="text-sm text-sky-600 hover:underline">
              パスワードをお忘れの方
            </Link>
          </div>

          <div className="mt-4 text-center">
            <p className="text-sm text-gray-500">
              アカウントをお持ちでない方は
              <Link href={`/auth/signup?redirect=${encodeURIComponent(redirect)}`} className="text-sky-600 hover:underline ml-1">
                新規登録
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

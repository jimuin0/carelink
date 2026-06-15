'use client';

import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { loginSchema, type LoginFormData } from '@/lib/validations-auth';
import Toast from '@/components/Toast';

export default function LoginPage() {
  // 見出し・カード外枠は Suspense の外（=SSR）で描画する。
  // useSearchParams を使う LoginContent を Suspense で包むと、フォールバックが
  // SSR HTML になるため、見出しを内側に置くと h1 が SSR されず（a11y/SEO 劣化・
  // E2E のヘッダ可視チェック失敗）になる。見出しを外出しして常に SSR で出す。
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-center mb-8">ログイン</h1>
          <Suspense fallback={<div className="min-h-[420px]" />}>
            <LoginContent />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function LoginContent() {
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
    <>
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
                aria-required="true"
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
                aria-required="true"
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
                <span className="bg-white px-4 text-gray-500">または</span>
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

          <button
            type="button"
            onClick={async () => {
              const supabase = createBrowserSupabaseClient();
              await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}` },
              });
            }}
            className="flex items-center justify-center gap-2 w-full py-3 mt-3 rounded-lg border border-gray-300 text-gray-700 font-bold hover:bg-gray-50 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Googleでログイン
          </button>

          <div className="mt-4 text-center">
            <Link href="/auth/forgot-password" className="text-sm text-sky-700 hover:underline">
              パスワードをお忘れの方
            </Link>
          </div>

          <div className="mt-4 text-center">
            <p className="text-sm text-gray-500">
              アカウントをお持ちでない方は
              <Link href={`/auth/signup?redirect=${encodeURIComponent(redirect)}`} className="text-sky-700 underline ml-1">
                新規登録
              </Link>
            </p>
          </div>

          <div className="mt-4 text-center">
            <Link href="/search" className="text-sm text-gray-500 hover:underline">
              施設を探す
            </Link>
          </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </>
  );
}

'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { signupSchema, type SignupFormData } from '@/lib/validations-auth';
import { prefectures, SITE_URL } from '@/lib/constants';
import Toast from '@/components/Toast';
import { isLineLoginEnabled } from '@/lib/line-availability';
import { safeRedirect } from '@/lib/safe-redirect';

const RESEND_COOLDOWN_SECONDS = 60;

function getSignupErrorMessage(error: { code?: string; message?: string }): string {
  // SDK は通信断・一時的なAuth障害を throw ではなく error として返すことがある。
  // この場合、登録が成立した可能性を否定せず、最初に受信メールを確認してもらう。
  if (error.code === 'unexpected_failure' || /network|fetch|timeout|retry/i.test(error.message ?? '')) {
    return '登録処理の結果を確認できませんでした。受信メールをご確認のうえ、時間をおいてもう一度お試しください。';
  }
  switch (error.code) {
    case 'weak_password':
      return 'パスワードの条件を満たしていません。入力内容をご確認ください。';
    case 'email_address_invalid':
    case 'validation_failed':
      return 'メールアドレスまたは入力内容をご確認ください。';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return '送信回数の上限に達しました。時間をおいてもう一度お試しください。';
    default:
      return '登録を受け付けられませんでした。時間をおいてもう一度お試しください。';
  }
}

export default function SignupPage() {
  // 見出し・カード外枠は Suspense の外（=SSR）で描画する（login と同様）。
  // useSearchParams を使う内容を Suspense で包むとフォールバックが SSR HTML になり、
  // h1 が SSR されず a11y/SEO 劣化・E2E のヘッダ可視チェック失敗になるため、見出しを外出しする。
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-center mb-8">新規登録</h1>
          <Suspense fallback={<div className="min-h-[480px]" />}>
            <SignupContent />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function SignupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 🔴 P0-4（docs/register-blocker-instructions.md §3）: 旧ガード
  // `raw.startsWith('/') && !raw.startsWith('//')` は `/\evil.com` を通してしまう
  // （URLパーサがバックスラッシュを `/` に正規化し、Next 16.3.0 の router.push が
  // 実際に外部サイトへ遷移する。詳細は src/lib/safe-redirect.ts のコメント参照）。
  // 判定を共有ヘルパーへ寄せ、「解決後の origin が一致するか」で止める。
  // SSR（初回HTML）では window が無いため SITE_URL（本番既定 origin）を使う。
  // クエリが `/` 始まりかどうかの判定結果は origin の値に依存しないため
  // （外部化される値は常にどの origin を基準にしても不一致になる）、
  // SSR と CSR とで redirect の計算結果がずれてハイドレーション不整合を起こすことはない。
  const origin = typeof window !== 'undefined' ? window.location.origin : SITE_URL;
  let redirect = safeRedirect(searchParams.get('redirect'), origin);
  // onboarding時はfacility_name/business_typeをredirectに含める
  const facilityName = searchParams.get('facility_name');
  const businessType = searchParams.get('business_type');
  if (redirect.startsWith('/admin/onboarding') && (facilityName || businessType)) {
    const params = new URLSearchParams();
    if (facilityName) params.set('facility_name', facilityName);
    if (businessType) params.set('business_type', businessType);
    redirect = `/admin/onboarding?${params.toString()}`;
  }
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [isResendCoolingDown, setIsResendCoolingDown] = useState(false);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const authOperationInFlight = useRef(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
  });

  // ログイン済みユーザーが /auth/signup に来た場合にフォームを表示し続けないよう、
  // loginページと同様にマウント時のセッション確認でredirect先へ即座に送る。
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.replace(redirect);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Google認証先で障害画面になり「戻る」と、bfcache により移動前の in-flight state が
    // 復元されるブラウザがある。復帰時だけ解除し、次の認証方式を選べるようにする。
    const releaseAfterBfcacheRestore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      authOperationInFlight.current = false;
      setIsGoogleSigningIn(false);
    };
    window.addEventListener('pageshow', releaseAfterBfcacheRestore);
    return () => window.removeEventListener('pageshow', releaseAfterBfcacheRestore);
  }, []);

  useEffect(() => {
    if (!pendingVerificationEmail || !isResendCoolingDown) return;
    const timer = window.setTimeout(() => setIsResendCoolingDown(false), RESEND_COOLDOWN_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [pendingVerificationEmail, isResendCoolingDown]);

  const showVerificationGuidance = (email: string) => {
    setPendingVerificationEmail(email);
    setResendStatus('idle');
    // resend はPKCE verifierを更新する。直後の再送が送信上限で失敗すると、先に送られた
    // メールまで検証不能になり得るため、最初の確認メールを待つ時間を設ける。
    setIsResendCoolingDown(true);
  };

  const onSubmit = async (data: SignupFormData) => {
    if (authOperationInFlight.current) return;

    authOperationInFlight.current = true;
    const supabase = createBrowserSupabaseClient();
    const emailRedirectTo = `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`;

    try {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          // display_name/phone/prefecture は auth.users.raw_user_meta_data に保存され、
          // handle_new_user トリガー(DDL)経由で profiles へ複製される。
          data: { display_name: data.display_name, phone: data.phone, prefecture: data.prefecture },
          emailRedirectTo,
        },
      });

      if (error) {
        // アカウント列挙対策: 既存登録メールかどうかをレスポンスで判別させない。
        // 未確認アカウントの確認メール再送は Supabase 側の制限を通す安全な経路だけを使う。
        if (error.message.includes('already registered')) {
          showVerificationGuidance(data.email);
        } else {
          setToast({ type: 'error', message: getSignupErrorMessage(error) });
        }
        return;
      }

      // メール確認を無効にした環境では session が即時に返る。確認待ち画面を出し続けず、
      // そのセッションを使って安全な相対パスの遷移先へ進む。
      if (signUpData?.session) {
        router.replace(redirect);
        router.refresh();
        return;
      }

      // user があるが session が無い場合だけ確認待ち状態にする。送達そのものは断定しない。
      if (signUpData?.user) {
        showVerificationGuidance(data.email);
        return;
      }

      setToast({ type: 'error', message: '登録状態を確認できませんでした。時間をおいてもう一度お試しください。' });
    } catch {
      setToast({ type: 'error', message: '登録処理の結果を確認できませんでした。受信メールをご確認のうえ、時間をおいてもう一度お試しください。' });
    } finally {
      authOperationInFlight.current = false;
    }
  };

  const resendVerificationEmail = async () => {
    if (!pendingVerificationEmail || resendStatus === 'sending' || isResendCoolingDown || authOperationInFlight.current) return;

    authOperationInFlight.current = true;
    setResendStatus('sending');
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: pendingVerificationEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
        },
      });
      setResendStatus(error ? 'error' : 'sent');
    } catch {
      setResendStatus('error');
    } finally {
      // 成否にかかわらず短時間の再実行を止め、以前のメールのPKCE検証情報を守る。
      setIsResendCoolingDown(true);
      authOperationInFlight.current = false;
    }
  };

  const startGoogleSignIn = async () => {
    if (authOperationInFlight.current) return;

    authOperationInFlight.current = true;
    setIsGoogleSigningIn(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}` },
      });
      if (error || !data?.url) {
        setToast({ type: 'error', message: 'Googleでの登録を開始できませんでした。時間をおいてもう一度お試しください。' });
        authOperationInFlight.current = false;
        setIsGoogleSigningIn(false);
      }
    } catch {
      setToast({ type: 'error', message: 'Googleでの登録を開始できませんでした。通信環境を確認してもう一度お試しください。' });
      authOperationInFlight.current = false;
      setIsGoogleSigningIn(false);
    }
  };

  if (pendingVerificationEmail) {
    return (
      <div className="space-y-5 text-center" aria-live="polite">
        <p className="text-gray-700 font-medium">登録を受け付けました。</p>
        <p className="text-sm text-gray-600 leading-relaxed">
          メール確認が必要な場合は、届いた確認メールを開いて登録を完了してください。すでに登録済みの方はログインできます。
          <br />
          確認案内の到着状況はメールサービスの処理により変わります。見当たらない場合は迷惑メールフォルダもご確認ください。
        </p>
        <button
          type="button"
          onClick={resendVerificationEmail}
          disabled={resendStatus === 'sending' || isResendCoolingDown}
          className="btn-primary w-full !py-3"
        >
          {resendStatus === 'sending'
            ? '再送を依頼中...'
            : isResendCoolingDown
            ? '確認メールの再送は1分後にできます'
            : '確認メールを再送する'}
        </button>
        {resendStatus === 'sent' && (
          <p className="text-sm text-green-700" role="status">再送を受け付けました。確認が必要なアカウントにはメールが届きます。</p>
        )}
        {resendStatus === 'error' && (
          <p className="text-sm text-red-600" role="alert">再送を受け付けられませんでした。時間をおいてもう一度お試しください。</p>
        )}
        <Link href={`/auth/login?redirect=${encodeURIComponent(redirect)}`} className="inline-block text-sm text-sky-700 hover:underline">
          既に確認を完了した方はログイン
        </Link>
        <p className="text-xs text-gray-500">再送後は、届いた最新の確認メールを同じブラウザで開いてください。</p>
      </div>
    );
  }

  const isStoreOnboarding = redirect.startsWith('/admin/onboarding');

  return (
    <>
          {isStoreOnboarding && (
            <p className="-mt-4 mb-6 text-center text-sm text-sky-700 bg-sky-50 rounded-lg px-4 py-2.5">
              施設オーナーさま向けのアカウント作成です。
              <br />
              登録後、施設情報の登録を続けます。
            </p>
          )}
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div>
              <label htmlFor="signup-name" className="form-label">お名前 <span className="text-red-500">*</span></label>
              <p id="signup-name-help" className="mt-1 text-xs text-gray-500">1〜50文字で入力してください。</p>
              <input
                {...register('display_name')}
                id="signup-name"
                className="form-input"
                autoComplete="name"
                aria-required="true"
                aria-describedby={errors.display_name ? 'signup-name-help signup-name-error' : 'signup-name-help'}
                aria-invalid={Boolean(errors.display_name)}
                minLength={1}
                maxLength={50}
              />
              {errors.display_name && <p id="signup-name-error" className="form-error" role="alert">{errors.display_name.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-email" className="form-label">メールアドレス <span className="text-red-500">*</span></label>
              <input
                {...register('email')}
                id="signup-email"
                type="email"
                className="form-input"
                autoComplete="email"
                aria-required="true"
                aria-describedby={errors.email ? 'signup-email-error' : undefined}
                aria-invalid={Boolean(errors.email)}
              />
              {errors.email && <p id="signup-email-error" className="form-error" role="alert">{errors.email.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-phone" className="form-label">電話番号 <span className="text-red-500">*</span></label>
              <p id="signup-phone-help" className="mt-1 text-xs text-gray-500">国内の電話番号を入力してください。ハイフンの有無と全角数字は自動で整えます。+81から始まる国際表記は使えません。</p>
              <input
                {...register('phone')}
                id="signup-phone"
                type="tel"
                className="form-input"
                autoComplete="tel"
                aria-required="true"
                aria-describedby={errors.phone ? 'signup-phone-help signup-phone-error' : 'signup-phone-help'}
                aria-invalid={Boolean(errors.phone)}
                inputMode="tel"
                maxLength={20}
              />
              {errors.phone && <p id="signup-phone-error" className="form-error" role="alert">{errors.phone.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-prefecture" className="form-label">都道府県 <span className="text-red-500">*</span></label>
              <select
                {...register('prefecture')}
                id="signup-prefecture"
                className="form-input"
                aria-required="true"
                aria-describedby={errors.prefecture ? 'signup-prefecture-error' : undefined}
                aria-invalid={Boolean(errors.prefecture)}
              >
                <option value="">選択してください</option>
                {prefectures.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              {errors.prefecture && <p id="signup-prefecture-error" className="form-error" role="alert">{errors.prefecture.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-password" className="form-label">パスワード <span className="text-red-500">*</span></label>
              <p id="signup-password-help" className="mt-1 text-xs text-gray-500">8〜128文字で入力してください。英字・数字・記号を組み合わせる必要はありません。</p>
              <div className="relative">
                <input
                  {...register('password')}
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input pr-10"
                  autoComplete="new-password"
                  aria-required="true"
                  aria-describedby={errors.password ? 'signup-password-help signup-password-error' : 'signup-password-help'}
                  aria-invalid={Boolean(errors.password)}
                  minLength={8}
                  maxLength={128}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                  aria-pressed={showPassword}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.94 10.94 0 0112 20c-6 0-10-6-10-8a11.28 11.28 0 013.16-4.5" />
                      <path d="M9.9 4.24A9.6 9.6 0 0112 4c6 0 10 6 10 8a11.24 11.24 0 01-1.87 2.87" />
                      <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              {errors.password && <p id="signup-password-error" className="form-error" role="alert">{errors.password.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-password-confirm" className="form-label">パスワード（確認） <span className="text-red-500">*</span></label>
              <input
                {...register('password_confirm')}
                id="signup-password-confirm"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                autoComplete="new-password"
                aria-required="true"
                aria-describedby={errors.password_confirm ? 'signup-password-confirm-error' : undefined}
                aria-invalid={Boolean(errors.password_confirm)}
                minLength={8}
                maxLength={128}
              />
              {errors.password_confirm && <p id="signup-password-confirm-error" className="form-error" role="alert">{errors.password_confirm.message}</p>}
            </div>

            <button type="submit" disabled={isSubmitting || isGoogleSigningIn} className="btn-primary w-full !py-3">
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

          {/* LINE ログインは LINE をローンチ対象に含めた場合のみ出す（line-availability.ts が単一判定）。 */}
          {isLineLoginEnabled() && (
            <a
              href={`/api/auth/line?redirect=${encodeURIComponent(redirect)}`}
              onClick={(event) => {
                if (isSubmitting || isGoogleSigningIn) event.preventDefault();
              }}
              aria-disabled={isSubmitting || isGoogleSigningIn}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-lg text-white font-bold hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#06C755' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 10.304C24 4.612 18.624.11 12 .11S0 4.612 0 10.304c0 5.04 4.47 9.262 10.51 10.058.41.088.968.27 1.11.618.126.316.082.81.04 1.129l-.18 1.068c-.054.33-.252 1.286 1.126.701 1.378-.585 7.438-4.382 10.148-7.502C24.648 14.312 24 12.392 24 10.304" />
              </svg>
              LINEで登録
            </a>
          )}

          <button
            type="button"
            onClick={startGoogleSignIn}
            disabled={isGoogleSigningIn || isSubmitting}
            className="flex items-center justify-center gap-2 w-full py-3 mt-3 rounded-lg border border-gray-300 text-gray-700 font-bold hover:bg-gray-50 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            {isGoogleSigningIn ? 'Googleに移動しています...' : 'Googleで登録'}
          </button>

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

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </>
  );
}

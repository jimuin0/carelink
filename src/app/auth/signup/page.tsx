'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { signupSchema, type SignupFormData } from '@/lib/validations-auth';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, PASSWORD_RULES_HINT } from '@/lib/password-policy';
import { prefectures, SITE_URL } from '@/lib/constants';
import Toast from '@/components/Toast';
import { isLineLoginEnabled } from '@/lib/line-availability';
import { LINE_CONSENT_REQUIRED_ERROR, LINE_SIGNUP_CONSENT_AGREED, LINE_SIGNUP_INTENT } from '@/lib/line-oauth';
import { safeRedirect } from '@/lib/safe-redirect';
import { verifyAuthUser } from '@/lib/auth-verification';
import { useClientReady } from '@/lib/use-client-ready';
import { isShopAccountSetupRedirect } from '@/lib/salon-browser-context';
import Button from '@/components/ui/Button';
import { REGISTRATION_TERMS as T } from '@/lib/registration-glossary';

const RESEND_COOLDOWN_SECONDS = 60;

function getSignupErrorMessage(error: { code?: string; message?: string }): string {
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

const HEADING_CLASS = 'text-2xl font-bold text-center mb-8';

/**
 * 外部登録（Google・LINE）で同意が無いときの文言。以前はトーストで出していたが、トーストは画面上部に
 * 固定表示されるため、スマホでは文句を言っている同意欄そのものを覆って隠していた。
 * 同意欄の直下（signup-terms-error）に出し、欄へフォーカスを移す。
 * （page.tsx は default 以外を export できないので、ここに置いて export しない）
 */
const EXTERNAL_SIGNUP_CONSENT_MESSAGES = {
  google: 'Googleで登録する場合も、利用規約とプライバシーポリシーへの同意が必要です。',
  line: 'LINEで登録する場合も、利用規約とプライバシーポリシーへの同意が必要です。',
} as const;

/** 掲載申込の続き（店舗アカウント作成）から来たかどうか。来院者向けの登録と見た目・文言を分ける。 */
function useShopAccountSignup(): boolean {
  const searchParams = useSearchParams();
  return isShopAccountSetupRedirect(safeRedirect(searchParams.get('redirect'), SITE_URL));
}

/** 見出しは店舗アカウント作成かどうかで変わる。SSR では fallback の h1 が出るので、h1 は常に SSR される。 */
function SignupHeading() {
  return <h1 className={HEADING_CLASS}>{useShopAccountSignup() ? '店舗アカウントの作成' : '新規登録'}</h1>;
}

export default function SignupPage() {
  // 見出し・カード外枠は Suspense の外（=SSR）で描画する（login と同様）。
  // useSearchParams を使う内容を Suspense で包むとフォールバックが SSR HTML になり、
  // h1 が SSR されず a11y/SEO 劣化・E2E のヘッダ可視チェック失敗になるため、見出しの fallback にも h1 を置く。
  //
  // 🔴 カードは上寄せにする（縦中央寄せにしない）。フォームは fallback の後から届くため、
  // 中央寄せだとカードの高さが変わった瞬間に見出しごとカード全体が上へ跳ねる
  // （低速回線の実測で CLS 0.115＝しきい値 0.1 超え。2026年10月23日）。上寄せなら伸び縮みするのは
  // カードの下端だけで、見えている内容は動かない。fallback の高さも最終形（約600px）に合わせてある。
  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center px-4 py-10 sm:py-16" data-testid="signup-shell">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-10">
          <Suspense fallback={<h1 className={HEADING_CLASS}>新規登録</h1>}>
            <SignupHeading />
          </Suspense>
          <Suspense fallback={<div className="min-h-[600px]" data-testid="signup-form-placeholder" />}>
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
  const clientReady = useClientReady();
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
  // 掲載申込の続き（/admin/onboarding・/register/recover へ戻る）として開かれた登録画面。
  // 来院者向けの「施設を探す」は出さず、申込と同じメールアドレスで作るよう案内する。
  const shopAccountSignup = useShopAccountSignup();
  // LINE の callback は、同意の証跡なしに新規アカウントを作らずここへ戻す（src/lib/line-oauth.ts の LINE_CONSENT_REQUIRED_ERROR）。
  const lineConsentRequired = searchParams.get('error') === LINE_CONSENT_REQUIRED_ERROR;
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [isResendCoolingDown, setIsResendCoolingDown] = useState(false);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const authOperationInFlight = useRef(false);

  const { register, handleSubmit, getValues, setValue, control, setError, clearErrors, setFocus, formState: { errors, isSubmitting } } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
  });
  // 同意欄にチェックがあるときだけ、LINE 登録フォームの consent に同意値を入れる
  // （同意は URL ではなく同一オリジンのフォーム送信で渡す。src/lib/line-oauth.ts「同意の受け渡し」）。
  const termsAgreed = useWatch({ control, name: 'terms_agreed' }) === true;

  // ログイン済みユーザーが /auth/signup に来た場合にフォームを表示し続けないよう、
  // loginページと同様にマウント時のセッション確認でredirect先へ即座に送る。
  useEffect(() => {
    let active = true;
    const checkSession = async () => {
      try {
        const identity = await verifyAuthUser(createBrowserSupabaseClient().auth);
        if (active && identity.state === 'verified') router.replace(redirect);
      } catch {
        // 初期確認の接続失敗でも登録フォームは利用可能に保つ。
      }
    };
    void checkSession();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
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

  /** 同意が無いまま外部登録を押したとき：理由を同意欄の直下に出し、欄へ移る（トーストは使わない）。 */
  const requireConsentInline = (provider: keyof typeof EXTERNAL_SIGNUP_CONSENT_MESSAGES) => {
    setError('terms_agreed', { type: 'manual', message: EXTERNAL_SIGNUP_CONSENT_MESSAGES[provider] });
    setFocus('terms_agreed');
    document.getElementById('signup-terms')?.scrollIntoView?.({ block: 'center' });
  };

  const showVerificationGuidance = (email: string) => {
    setPendingVerificationEmail(email);
    setResendStatus('idle');
    // 再送はPKCE verifierを更新するため、直後の連打で既存メールを無効化しない。
    setIsResendCoolingDown(true);
  };

  const onSubmit = async (data: SignupFormData) => {
    if (authOperationInFlight.current) return;
    authOperationInFlight.current = true;
    try {
      // Client初期化自体が失敗しても finally で排他ロックを必ず解放する。
      const supabase = createBrowserSupabaseClient();
      const emailRedirectTo = `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`;
      const { data: result, error } = await supabase.auth.signUp({
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
        if (/already registered/i.test(error.message ?? '')) {
          showVerificationGuidance(data.email);
        } else {
          setToast({ type: 'error', message: getSignupErrorMessage(error) });
        }
        return;
      }

      if (result.session) {
        router.replace(redirect);
        router.refresh();
        return;
      }

      if (result.user) {
        // identities=[]の既登録疑似応答でも登録有無・メール送達を断定しない案内に揃える。
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

  const submitVisibleFields = (event: FormEvent<HTMLFormElement>) => {
    // Autofill can update the native controls without emitting change events.
    // Reconcile at submission so validation and Auth use exactly what is visible,
    // including the current consent checkbox. Never persist or log credentials.
    const visibleFields = new FormData(event.currentTarget);
    for (const field of ['display_name', 'email', 'phone', 'prefecture', 'password', 'password_confirm'] as const) {
      setValue(field, String(visibleFields.get(field) ?? ''));
    }
    // RHF uses the validated output type (literal true), but its raw checkbox
    // buffer also contains false. The unchanged resolver must reject that value.
    setValue('terms_agreed', visibleFields.has('terms_agreed') as SignupFormData['terms_agreed']);
    void handleSubmit(onSubmit)(event);
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
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}` },
      });
      setResendStatus(error ? 'error' : 'sent');
    } catch {
      setResendStatus('error');
    } finally {
      setIsResendCoolingDown(true);
      authOperationInFlight.current = false;
    }
  };

  const startGoogleSignup = async () => {
    if (getValues('terms_agreed') !== true) {
      requireConsentInline('google');
      return;
    }
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
      setToast({ type: 'error', message: 'Googleでの登録を開始できませんでした。時間をおいてもう一度お試しください。' });
      authOperationInFlight.current = false;
      setIsGoogleSigningIn(false);
    }
  };

  if (pendingVerificationEmail) {
    return (
      <div className="space-y-5 text-center" aria-live="polite">
        <p className="text-gray-700 font-medium">確認メールを送信しました</p>
        {/* 送信先を見せないと、入力ミスに気づけないまま「届かない」と待ち続けることになる。 */}
        <p className="text-sm text-gray-700">送信先：<span className="font-bold break-all" data-testid="signup-sent-to">{pendingVerificationEmail}</span></p>
        <p className="text-sm text-gray-600 leading-relaxed">メール内のリンクを開いて、メールアドレスの確認を完了してください。見当たらない場合は迷惑メールフォルダもご確認ください。すでに登録済みのメールアドレスの場合、確認メールは届きません。そのままログインしてください。</p>
        {/* 確認メールのリンクはメールアプリが別のタブ・別のブラウザで開くことが多い。確認さえ済めば、
            このタブ（掲載申込の受付情報が残っているタブ）でログインして同じ続きへ進める。 */}
        <Button href={`/auth/login?redirect=${encodeURIComponent(redirect)}`} prefetch="auto" size="lg" fullWidth>確認が済んだら：ログインして続ける</Button>
        <p className="text-xs text-gray-500">確認メールのリンクを別のブラウザやメールアプリで開いた場合も、確認が済んでいればこの画面からログインして続けられます。</p>
        <Button variant="secondary" size="lg" fullWidth onClick={resendVerificationEmail} disabled={resendStatus === 'sending' || isResendCoolingDown}>
          {resendStatus === 'sending' ? '再送を依頼中...' : isResendCoolingDown ? '確認メールの再送は1分後にできます' : '確認メールを再送する'}
        </Button>
        {resendStatus === 'sent' && <p className="text-sm text-green-700" role="status">再送を受け付けました。確認が必要なアカウントにはメールが届きます。</p>}
        {resendStatus === 'error' && <p className="text-sm text-red-600" role="alert">再送を受け付けられませんでした。時間をおいてもう一度お試しください。</p>}
        <p className="text-xs text-gray-500">再送後は、届いた最新の確認メールを開いてください。</p>
      </div>
    );
  }

  return (
    <>
          {shopAccountSignup && (
            <div className="mb-8 rounded-xl bg-sky-50 p-5 text-sm leading-6 text-sky-900" data-testid="shop-signup-guide">
              <p className="font-bold">申込と同じメールアドレスで作成してください</p>
              <p className="mt-2">掲載申込に使ったメールアドレスで登録すると、申込内容を管理画面に引き継げます。</p>
            </div>
          )}
          {lineConsentRequired && (
            <p role="alert" className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="signup-line-consent-required">
              LINEで登録するには、利用規約・プライバシーポリシーへの同意が必要です。下の同意欄にチェックしてから、もう一度「LINEで登録」を押してください。
            </p>
          )}
          <form onSubmit={submitVisibleFields} noValidate>
            <fieldset disabled={!clientReady} className="space-y-7">
            <div>
              <label htmlFor="signup-name" className="mb-3 block text-sm font-medium text-gray-700">お名前 <span className="text-red-600">*</span></label>
              <input
                {...register('display_name')}
                id="signup-name"
                className="form-input"
                autoComplete="name"
                aria-required="true"
                aria-describedby={errors.display_name ? 'signup-name-error' : undefined}
                aria-invalid={Boolean(errors.display_name)}
                minLength={1}
                maxLength={50}
              />
              {errors.display_name && <p id="signup-name-error" className="mt-3 text-sm leading-6 text-red-700" role="alert">{errors.display_name.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-email" className="mb-3 block text-sm font-medium text-gray-700">メールアドレス <span className="text-red-600">*</span></label>
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
              {errors.email && <p id="signup-email-error" className="mt-3 text-sm leading-6 text-red-700" role="alert">{errors.email.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-phone" className="mb-3 block text-sm font-medium text-gray-700">電話番号 <span className="text-red-600">*</span></label>
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
              <p id="signup-phone-help" className="mt-3 text-sm leading-6 text-gray-600">ハイフンあり・なし、どちらでも入力できます。</p>
              {errors.phone && <p id="signup-phone-error" className="mt-3 text-sm leading-6 text-red-700" role="alert">{errors.phone.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-prefecture" className="mb-3 block text-sm font-medium text-gray-700">都道府県 <span className="text-red-600">*</span></label>
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
              {errors.prefecture && <p id="signup-prefecture-error" className="mt-3 text-sm leading-6 text-red-700" role="alert">{errors.prefecture.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-password" className="mb-3 block text-sm font-medium text-gray-700">パスワード <span className="text-red-600">*</span></label>
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
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={PASSWORD_MAX_BYTES}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center min-w-[32px] min-h-[32px] rounded text-gray-500 hover:text-gray-600"
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
              <p id="signup-password-help" className="mt-3 text-sm leading-6 text-gray-600">{PASSWORD_RULES_HINT}</p>
              {errors.password && <p id="signup-password-error" className="mt-3 text-sm leading-6 text-red-700" role="alert">{errors.password.message}</p>}
            </div>

            <div>
              <label htmlFor="signup-password-confirm" className="mb-3 block text-sm font-medium text-gray-700">パスワード（確認） <span className="text-red-600">*</span></label>
              <input
                {...register('password_confirm')}
                id="signup-password-confirm"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                autoComplete="new-password"
                aria-required="true"
                aria-describedby={errors.password_confirm ? 'signup-password-confirm-error' : undefined}
                aria-invalid={Boolean(errors.password_confirm)}
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_BYTES}
              />
              {errors.password_confirm && <p id="signup-password-confirm-error" className="mt-3 text-sm leading-6 text-red-700" role="alert">{errors.password_confirm.message}</p>}
            </div>

            <label htmlFor="signup-terms" className="flex items-start gap-3 text-sm leading-6 text-gray-600">
              <input {...register('terms_agreed', { onChange: event => { if (event.target.checked) clearErrors('terms_agreed'); } })} id="signup-terms" type="checkbox" aria-required="true"
                aria-invalid={Boolean(errors.terms_agreed)} aria-describedby={errors.terms_agreed ? 'signup-terms-error' : undefined}
                className="mt-1.5 h-4 w-4 shrink-0 scroll-mt-24 rounded-sm border-gray-300" />
              <span><Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-sky-700 underline">利用規約</Link>
                および<Link href="/privacy" target="_blank" rel="noopener noreferrer" className="text-sky-700 underline">プライバシーポリシー</Link>に同意する（必須）</span>
            </label>
            {errors.terms_agreed && <p id="signup-terms-error" className="mt-3 text-sm leading-6 text-red-700" role="alert">{errors.terms_agreed.message}</p>}
            <Button type="submit" disabled={isSubmitting || isGoogleSigningIn} size="lg" fullWidth>
              {isSubmitting ? (shopAccountSignup ? `${T.account}を作成中...` : '登録中...') : shopAccountSignup ? `${T.account}を作成` : '新規登録'}
            </Button>
            </fieldset>
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

          {/* LINE ログインは LINE をローンチ対象に含めた場合のみ出す（line-availability.ts が単一判定）。 */}
          {/* 同意は URL ではなく、このフォームの POST（サーバー側で CSRF 検証）で渡す。URL に載せると
              誰でもそのリンクを作って開けるため、同意なしで新規アカウントが作れた（PR#793 レビュー P2）。 */}
          {isLineLoginEnabled() && (
            <form
              method="post"
              action="/api/auth/line"
              data-testid="signup-line-form"
              onSubmit={(event) => {
                if (isSubmitting || isGoogleSigningIn) { event.preventDefault(); return; }
                // Google と同じく、LINE で登録する場合も利用規約・プライバシーポリシーへの同意が要る
                // （以前は LINE だけ同意を見ずにアカウントを作れた）。
                if (getValues('terms_agreed') !== true) {
                  event.preventDefault();
                  requireConsentInline('line');
                }
              }}
            >
              <input type="hidden" name="redirect" value={redirect} />
              <input type="hidden" name="intent" value={LINE_SIGNUP_INTENT} />
              <input type="hidden" name="consent" value={termsAgreed ? LINE_SIGNUP_CONSENT_AGREED : ''} />
              <button
                type="submit"
                disabled={isSubmitting || isGoogleSigningIn}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-lg text-white font-bold hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#06C755' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M24 10.304C24 4.612 18.624.11 12 .11S0 4.612 0 10.304c0 5.04 4.47 9.262 10.51 10.058.41.088.968.27 1.11.618.126.316.082.81.04 1.129l-.18 1.068c-.054.33-.252 1.286 1.126.701 1.378-.585 7.438-4.382 10.148-7.502C24.648 14.312 24 12.392 24 10.304" />
                </svg>
                LINEで登録
              </button>
            </form>
          )}

          <Button
            variant="ghost"
            size="lg"
            fullWidth
            className="mt-3"
            onClick={startGoogleSignup}
            disabled={!clientReady || isGoogleSigningIn || isSubmitting}
          >
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            {isGoogleSigningIn ? 'Googleに移動しています...' : 'Googleで登録'}
          </Button>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              アカウントをお持ちの方は
              <Link href={`/auth/login?redirect=${encodeURIComponent(redirect)}`} className="text-sky-700 underline hover:no-underline ml-1">
                ログイン
              </Link>
            </p>
          </div>

          {!shopAccountSignup && (
            <div className="mt-4 text-center">
              <Link href="/search" className="text-sm text-gray-500 hover:underline">
                施設を探す
              </Link>
            </div>
          )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </>
  );
}

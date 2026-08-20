/**
 * 掲載登録（/register）完了後の店舗化導線（/auth/signup・/auth/login → /admin/onboarding）
 * に facility_name / business_type を安全に載せるための単一ビルダー。
 *
 * 🔴 なぜこの形か（2026年8月20日）
 * 従来は facility_name / business_type を `redirect` の「兄弟」クエリとして置いていた：
 *   /auth/signup?redirect=/admin/onboarding&facility_name=…&business_type=…
 *
 * しかし src/middleware.ts の「認証済みユーザーが /auth/login・/auth/signup を開いた時の
 * リダイレクト」分岐は、`redirect` クエリの値だけを safeRedirect（src/lib/safe-redirect.ts）
 * で解決し、その解決結果（pathname+search+hash）しか転送しない。兄弟クエリは
 * `request.nextUrl.searchParams.get('redirect')` の外側にあるため丸ごと落ちる。
 *
 * → ログイン済みの人が受付メールのリンクを踏むと facility_name / business_type が消え、
 *    /admin/onboarding が手入力フォームに落ちる。
 *
 * middleware 側に「任意の兄弟クエリを転送する」機能を足すのは、転送してよいクエリの
 * allowlist 管理が必要になり攻撃面が増えるため避けた。代わりに、リンク側を
 * 「redirect の中にネストする」形へ統一する：
 *
 *   /auth/signup?redirect=<encodeURIComponent('/admin/onboarding?facility_name=…&business_type=…')>
 *
 * これなら middleware は既に正しく転送する（safeRedirect は `new URL(raw, origin)` で
 * raw 自身の query を解決し、pathname+search+hash をそのまま返すため）。
 *
 * 発生源は4箇所（src/app/register/complete/page.tsx のサインアップ・ログイン導線2本、
 * src/lib/email.ts の受付メール・フォローメール2本）。組み立ての重複・二重実装によるズレを
 * 避けるため、全箇所がこの1本を通す。
 */

export interface OnboardingLinkParams {
  facilityName: string;
  businessType: string;
}

/**
 * `/admin/onboarding` に facility_name / business_type を載せた相対パスを組み立てる。
 * `URLSearchParams` を使うため `&` `?` `#` や日本語を含む値でも安全にエンコードされる。
 *
 * 空文字（未取得・未入力）のキーはクエリに含めない。どちらも空なら
 * クエリなしの `/admin/onboarding` を返す（この関数の呼び出し側は「無ければ手入力」で
 * 問題なく動く前提のため、空パラメータを付けても意味が無い）。
 */
export function buildOnboardingRedirectPath(params: OnboardingLinkParams): string {
  const search = new URLSearchParams();
  if (params.facilityName) search.set('facility_name', params.facilityName);
  if (params.businessType) search.set('business_type', params.businessType);
  const qs = search.toString();
  return qs ? `/admin/onboarding?${qs}` : '/admin/onboarding';
}

/**
 * `/auth/signup` または `/auth/login` への、上記をネストした導線 URL（相対パス）を
 * 組み立てる。呼び出し側で `redirect` を二重にエンコードする必要はない
 * （このヘルパーが `encodeURIComponent` まで行う）。
 *
 * メール本文など絶対 URL が必要な場面では、呼び出し側で SITE_URL を前置すること
 * （このモジュールは SITE_URL に依存しない＝相対パスの組み立てだけに責務を絞る）。
 */
export function buildOnboardingAuthPath(
  authPage: 'signup' | 'login',
  params: OnboardingLinkParams
): string {
  const redirect = buildOnboardingRedirectPath(params);
  return `/auth/${authPage}?redirect=${encodeURIComponent(redirect)}`;
}

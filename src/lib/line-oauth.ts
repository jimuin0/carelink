import { normalizeSiteUrl } from './constants';
import { REGISTRATION_TERMS_SHA256 } from './registration-consent';

/**
 * LINE ログイン（/api/auth/line → /api/auth/line/callback）が共有する定数と判定。
 * route.ts は HTTP メソッド以外を export できないため、両ルートと登録画面が使うものをここに置く。
 *
 * 【同意マーカー（2026年10月23日・PR#792 レビュー指摘 P2）】
 * 「LINEで登録」の利用規約チェックは登録画面の onClick でしか見ておらず、/api/auth/line を
 * 直接（またはコピーしたリンクで）開くと同意なしで callback が新規アカウントを作れた。
 * 登録画面はチェック後にだけこのマーカー付きで /api/auth/line を開き、ルートはそれを
 * httpOnly Cookie に保存し、callback は【新規作成のときだけ】現在の規約版と一致するかを見る。
 * 版は掲載申込と同じ REGISTRATION_TERMS_SHA256（利用規約・プライバシーポリシー本文の指紋）で、
 * 規約が改定されて指紋が変われば、古い画面・古いリンクから始めた登録は同意し直しになる。
 */
export const LINE_SIGNUP_INTENT = 'signup';
export const LINE_SIGNUP_CONSENT_MARKER = `terms-${REGISTRATION_TERMS_SHA256}`;
export const LINE_SIGNUP_CONSENT_COOKIE = 'line_oauth_signup_consent';
export const LINE_CONSENT_REQUIRED_ERROR = 'line_consent_required';

/** 開始リクエストが「登録画面で規約に同意した後の LINE 登録」かどうか。 */
export function hasLineSignupConsent(searchParams: URLSearchParams): boolean {
  return searchParams.get('intent') === LINE_SIGNUP_INTENT
    && searchParams.get('consent') === LINE_SIGNUP_CONSENT_MARKER;
}

/** callback で受け取った Cookie 値が現在の規約版への同意かどうか。 */
export function isCurrentLineSignupConsent(value: string | undefined): boolean {
  return value === LINE_SIGNUP_CONSENT_MARKER;
}

/**
 * LINE OAuth の redirect_uri とリダイレクト先に使う公開 origin。
 *
 * 🔴 request.url から組み立てない。本番（Vercel）では request.url の origin が内部ホストになり、
 * 実際に redirect_uri=https://0.0.0.0:3000/api/auth/line/callback で LINE へ送っていた。
 * Google カレンダー連携の redirect_uri と同じ SITE_URL の正規化（constants.ts）を使う。
 * ローカルは .env.example の NEXT_PUBLIC_BASE_URL=http://localhost:3000 がそのまま効く。
 * 呼び出し時に読むのはテストで env を差し替えられるようにするため。
 */
export function lineOAuthOrigin(): string {
  return normalizeSiteUrl(process.env.NEXT_PUBLIC_BASE_URL);
}

export function lineOAuthCallbackUrl(): string {
  return `${lineOAuthOrigin()}/api/auth/line/callback`;
}

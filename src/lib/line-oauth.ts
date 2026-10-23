import { normalizeSiteUrl } from './constants';
import { REGISTRATION_TERMS_SHA256 } from './registration-consent';

/**
 * LINE ログイン（/api/auth/line → /api/auth/line/callback）が共有する定数と判定。
 * route.ts は HTTP メソッド以外を export できないため、両ルートと登録画面が使うものをここに置く。
 *
 * 【同意の受け渡し（2026年10月23日・PR#792/#793 レビュー指摘 P2）】
 * 「LINEで登録」の利用規約チェックは登録画面の onClick でしか見ておらず、/api/auth/line を
 * 直接開くと同意なしで callback が新規アカウントを作れた。最初の修正では同意マーカーを URL の
 * クエリに載せたが、マーカーは公開された定数なので、`?intent=signup&consent=<マーカー>` を
 * 直接開く・リンクを共有するだけで同意 Cookie が付いてしまった（PR#793 レビュー）。
 *
 * そこで同意は【URL ではなく、登録画面からの同一オリジンのフォーム送信】で受け取る。
 *   - GET /api/auth/line は同意 Cookie を【決して付けない】（クエリは無視し、常に消す）。
 *   - POST /api/auth/line は checkCsrf（Origin/Referer の host 一致）を通ったときだけ受け付け、
 *     フォームの intent=signup・consent=agreed を見て同意 Cookie を付ける。値は固定の文字列で
 *     足りる。「自サイトの登録画面のフォームから来た」ことは CSRF 検証が保証するため。
 *   - Cookie の値は現在の規約版（LINE_SIGNUP_CONSENT_MARKER）でサーバー側だけが持つ。
 *     callback は【新規作成のときだけ】現在の版と一致するかを見る。版は掲載申込と同じ
 *     REGISTRATION_TERMS_SHA256（利用規約・プライバシーポリシー本文の指紋）で、規約が改定されて
 *     指紋が変われば、改定前に始めた登録は同意し直しになる。
 */
export const LINE_SIGNUP_INTENT = 'signup';
/** 登録画面のフォームが、規約にチェックがあるときだけ送る値。 */
export const LINE_SIGNUP_CONSENT_AGREED = 'agreed';
/** 同意 Cookie に保存する規約版。サーバー側（/api/auth/line と callback）だけが使う。 */
export const LINE_SIGNUP_CONSENT_MARKER = `terms-${REGISTRATION_TERMS_SHA256}`;
export const LINE_SIGNUP_CONSENT_COOKIE = 'line_oauth_signup_consent';
export const LINE_CONSENT_REQUIRED_ERROR = 'line_consent_required';
/** LINE の認可エンドポイント。middleware の CSP form-action はこのオリジンを許可する。 */
export const LINE_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';

/**
 * 登録画面のフォーム送信が「規約に同意した後の LINE 登録」かどうか。
 * 呼び出し側（POST /api/auth/line）は先に checkCsrf を通していること。
 * ファイルが送られてきても文字列とは一致しないので偽になる。
 */
export function hasLineSignupConsent(form: FormData): boolean {
  return form.get('intent') === LINE_SIGNUP_INTENT
    && form.get('consent') === LINE_SIGNUP_CONSENT_AGREED;
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

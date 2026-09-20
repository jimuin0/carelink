/**
 * クライアント側 reCAPTCHA v3 トークン取得ヘルパー。
 *
 * サーバ側 `verifyRecaptcha`（src/lib/recaptcha.ts）は `RECAPTCHA_SECRET_KEY` 設定時に
 * token を必須化し、欠如を 403 で fail-closed 遮断する。だが従来クライアントは token を一切
 * 生成・送信していなかったため、本番で secret を設定すると当該フォーム（レビュー投稿）が
 * 全件 403 で失敗する不整合があった。本ヘルパーで grecaptcha v3 を遅延ロードして実トークンを
 * 取得し、サーバの Bot 検証を実機能化する（発症前予防）。
 *
 * 環境変数 `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` 未設定時（開発/CI）は null を返す＝従来通りトークンを
 * 送らず、サーバも secret 未設定でスキップするため動作不変。site key 設定時のみ実トークンを送る。
 */

interface GrecaptchaV3 {
  ready: (cb: () => void) => void;
  execute: (siteKey: string, opts: { action: string }) => Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: GrecaptchaV3;
  }
}

let scriptPromise: Promise<void> | null = null;
const RECAPTCHA_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), RECAPTCHA_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => {
    // Timer handles may be numeric 0 in browsers; clearTimeout(undefined) is a no-op.
    clearTimeout(timer!);
  });
}

function loadRecaptchaScript(siteKey: string): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('recaptcha: no document'));
      return;
    }
    if (window.grecaptcha) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // ロード失敗時は次回再試行できるようキャッシュを破棄する。
      scriptPromise = null;
      reject(new Error('recaptcha: script load failed'));
    };
    document.head.appendChild(script);
  });
  return withTimeout(scriptPromise, 'recaptcha: script load timeout').catch((error) => {
    // ロードが固まった場合も、次回は新しいscriptを生成して再試行できるようにする。
    scriptPromise = null;
    throw error;
  });
}

/**
 * 指定 action の reCAPTCHA v3 トークンを取得する。
 * site key 未設定・ロード失敗・実行失敗時は null（呼び出し側は token 無しで送信＝サーバ判断に委ねる）。
 */
export async function getRecaptchaToken(action: string): Promise<string | null> {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!siteKey) return null;
  try {
    // loadRecaptchaScript が解決した時点で document（従って window）は存在する
    // （document 不在時は reject され下の catch で null になる）。
    await loadRecaptchaScript(siteKey);
    const grecaptcha = window.grecaptcha;
    if (!grecaptcha) return null;
    await withTimeout(new Promise<void>((r) => grecaptcha.ready(() => r())), 'recaptcha: ready timeout');
    return await withTimeout(grecaptcha.execute(siteKey, { action }), 'recaptcha: execute timeout');
  } catch {
    return null;
  }
}

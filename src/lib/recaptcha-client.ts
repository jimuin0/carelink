/** Client-only reCAPTCHA v3. Unconfigured development returns null; configured
 * failures stop submission and retain live input rather than hanging or posting
 * without the requested bot verification. No token/provider error is logged. */
interface GrecaptchaV3 {
  ready: (cb: () => void) => void;
  execute: (siteKey: string, opts: { action: string }) => Promise<string>;
}
declare global { interface Window { grecaptcha?: GrecaptchaV3; } }

export const RECAPTCHA_CLIENT_UNAVAILABLE_MESSAGE = '送信前の確認を完了できませんでした。入力はこの画面に保持されています。通信環境を確認し、時間をおいて再度お試しください。';
export class RecaptchaClientError extends Error {
  constructor() { super(RECAPTCHA_CLIENT_UNAVAILABLE_MESSAGE); }
}
const SCRIPT_TIMEOUT_MS = 8000;
const VERIFICATION_TIMEOUT_MS = 5000;
let scriptPromise: Promise<void> | null = null;
let ownedScript: HTMLScriptElement | undefined;

/** Each attempt settles once. Requests share only loading, never action tokens.
 * Late ready callbacks/execute results cannot authorize a timed-out request. */
function bounded<T>(start: (resolve: (value: T) => void, reject: () => void) => void | Promise<void>, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true; clearTimeout(timer); reject(new RecaptchaClientError());
    };
    const timer = setTimeout(fail, timeout);
    try {
      Promise.resolve(start(value => {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve(value);
      }, fail)).catch(fail);
    } catch { fail(); }
  });
}

function loadRecaptchaScript(siteKey: string): Promise<void> {
  if (scriptPromise) return scriptPromise;
  let script: HTMLScriptElement | undefined;
  const loading = bounded<void>((resolve, reject) => {
    if (typeof document === 'undefined') { reject(); return; }
    if (window.grecaptcha) { resolve(); return; }
    script = document.createElement('script');
    ownedScript = script;
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true; script.defer = true;
    script.onload = () => { if (window.grecaptcha) resolve(); else reject(); };
    script.onerror = reject;
    document.head.appendChild(script);
  }, SCRIPT_TIMEOUT_MS);
  // Only loading is cached. A failed attempt is removed so retry installs one
  // new script. Old DOM callbacks are detached before releasing that cache.
  scriptPromise = loading.catch(() => {
    if (script) {
      script.onload = null; script.onerror = null;
      try { script.remove(); } catch { /* Retry must still use a fresh attempt. */ }
      ownedScript = undefined;
    }
    scriptPromise = null;
    throw new RecaptchaClientError();
  });
  return scriptPromise;
}

export async function getRecaptchaToken(action: string): Promise<string | null> {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!siteKey) return null;
  const loading = loadRecaptchaScript(siteKey);
  await loading;
  const grecaptcha = window.grecaptcha;
  if (!grecaptcha) {
    // A removed/corrupted SDK must not make every future retry use a resolved
    // loader cache. Only this loader generation can detach its owned script.
    if (scriptPromise === loading) {
      scriptPromise = null;
      try { ownedScript?.remove(); } catch { /* The next attempt remains fresh. */ }
      ownedScript = undefined;
    }
    throw new RecaptchaClientError();
  }
  await bounded<void>(resolve => grecaptcha.ready(resolve), VERIFICATION_TIMEOUT_MS);
  const token = await bounded<string>(async resolve => {
    // The bounded owner handles asynchronous producer rejection as well as
    // synchronous starts; late execute outcomes can settle neither phase again.
    resolve(await grecaptcha.execute(siteKey, { action }));
  }, VERIFICATION_TIMEOUT_MS);
  if (typeof token !== 'string' || !token.trim()) throw new RecaptchaClientError();
  return token;
}

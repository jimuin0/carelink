import { safeRedirect } from './safe-redirect';
import { POST_LOGIN_LANDING_PATH } from './post-login-landing';

/**
 * パスワード再設定をはさんでも、ログイン画面の戻り先（?redirect・例: /admin）を失わないための保存（2026年10月23日）。
 *
 * 🔴 以前は ログイン → パスワードをお忘れの方 → 再設定 の途中で redirect が落ち、再設定後は
 * 必ず /auth/login → /mypage に着地していた（店舗オーナーが管理画面へ戻れない）。
 *
 * 戻り先を再設定メールのリンク（redirectTo）のクエリに載せないのは、Supabase の Redirect URL
 * 許可リストに一致しないと再設定リンク自体がサイトのトップへ飛ばされて壊れるため（ダッシュボード側の
 * 設定に依存させない）。再設定リンクは PKCE の都合で申請したのと同じブラウザでしか使えないので、
 * 同じブラウザの localStorage に「パスだけ」を置けば足りる。個人情報は置かない。
 */
export const PASSWORD_RESET_REDIRECT_KEY = 'carelink.password-reset-redirect.v1';
/** 再設定リンクの有効期限（既定 1 時間）より長く残さない。 */
export const PASSWORD_RESET_REDIRECT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 再設定の申請時に戻り先を保存する。戻り先が無ければ古い保存を消す（別の人の戻り先を使わない）。 */
export function savePasswordResetRedirect(store: Store, raw: string | null, origin: string, now = Date.now()): void {
  try {
    if (!raw) { store.removeItem(PASSWORD_RESET_REDIRECT_KEY); return; }
    store.setItem(PASSWORD_RESET_REDIRECT_KEY, JSON.stringify({ path: safeRedirect(raw, origin), savedAt: now }));
  } catch {
    // 保存できなくても再設定そのものは続ける（戻り先が既定の振り分けになるだけ）。
  }
}

/** 再設定の完了時に戻り先を取り出して消す。無い・古い・壊れている場合はログイン後の既定の振り分け。 */
export function takePasswordResetRedirect(store: Store, origin: string, now = Date.now()): string {
  let saved: unknown = null;
  try {
    const raw = store.getItem(PASSWORD_RESET_REDIRECT_KEY);
    store.removeItem(PASSWORD_RESET_REDIRECT_KEY);
    saved = JSON.parse(raw ?? 'null');
  } catch {
    return POST_LOGIN_LANDING_PATH;
  }
  if (!saved || typeof saved !== 'object') return POST_LOGIN_LANDING_PATH;
  const { path, savedAt } = saved as { path?: unknown; savedAt?: unknown };
  if (typeof path !== 'string' || typeof savedAt !== 'number') return POST_LOGIN_LANDING_PATH;
  const age = now - savedAt;
  if (age < 0 || age >= PASSWORD_RESET_REDIRECT_MAX_AGE_MS) return POST_LOGIN_LANDING_PATH;
  return safeRedirect(path, origin);
}

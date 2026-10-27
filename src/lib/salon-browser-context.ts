import { z } from 'zod';

export const SALON_BROWSER_CONTEXT_KEY = 'carelink.salon-submission.v1';
const contextSchema = z.object({ version: z.literal(1), intentId: z.uuid(),
  phase: z.enum(['prepared', 'attempted', 'confirmed']),
}).strict();
export type SalonBrowserContext = z.infer<typeof contextSchema>;
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export type SalonBrowserRead = { state: 'empty' } | { state: 'unavailable' }
  | { state: 'ready'; context: SalonBrowserContext };

/** Tab-scoped selector and progress only, not authorization. Never persist
 * names, contact details, form bodies, files, signed upload tokens or proof. */
export function readSalonBrowserContext(store: Store, key = SALON_BROWSER_CONTEXT_KEY): SalonBrowserRead {
  try {
    const value = store.getItem(key);
    if (value === null) return { state: 'empty' };
    const parsed = contextSchema.safeParse(JSON.parse(value));
    return parsed.success ? { state: 'ready', context: parsed.data } : { state: 'unavailable' };
  } catch { return { state: 'unavailable' }; }
}
export function saveSalonBrowserContext(store: Store, value: SalonBrowserContext, key = SALON_BROWSER_CONTEXT_KEY): boolean {
  const parsed = contextSchema.safeParse(value);
  if (!parsed.success) return false;
  try {
    const encoded = JSON.stringify(parsed.data);
    store.setItem(key, encoded);
    return store.getItem(key) === encoded;
  } catch { return false; }
}
// URL contains only a mode marker, never a selector or applicant data. The
// same-tab sessionStorage survives full-page OAuth; missing state fails closed.
export const SALON_ONBOARDING_PATH = '/admin/onboarding?handoff=registration';
export const SALON_COMPLETE_PATH = '/register/complete?handoff=registration';
export function salonHandoffAuthPath(page: 'signup' | 'login'): string {
  return `/auth/${page}?redirect=${encodeURIComponent(SALON_ONBOARDING_PATH)}`;
}

export const SALON_RECOVERY_CONTEXT_KEY = 'carelink.salon-recovery.v1';
export const SALON_RECOVERY_ONBOARDING_PATH = '/admin/onboarding?handoff=recovered';
/** 送信済みの掲載申込を、申込時の確認済みメールアドレスで選び直して引き継ぐ画面。 */
export const SALON_RECOVERY_PATH = '/register/recover';
/**
 * 同じタブの受付情報（intent）が使えない人を、申込内容ごと引き継げる唯一の入口へ送る導線。
 * 掲載申込者へ後日送るメール（onboarding-followup）はこれを使う。intent は 72 時間で失効し、
 * メールには選択子も証明も載せられないため、受付の特定は /register/recover が
 * 確認済みのログインメールで行う（/admin/onboarding へ直接送ると、申込を取り込まない空の店舗が作られ、
 * その後は ALREADY_MEMBER で復旧もできなくなる）。
 */
export function salonRecoveryAuthPath(page: 'signup' | 'login'): string {
  return `/auth/${page}?redirect=${encodeURIComponent(SALON_RECOVERY_PATH)}`;
}
/**
 * 申込したタブの受付情報（sessionStorage）が無いまま引き継ぎ画面へ来た人を送る先（2026年10月23日）。
 * 確認メールのリンクはメールアプリが新しいタブ・別のブラウザで開くため、受付情報は必ず失われる。
 * 汎用の「通信環境を確認して再読み込み」を出し続けると永久に進めないので、確認済みメールで
 * 申込を一覧できる /register/recover へ自動で送り、「申込を選んでください」と案内する。
 * 重複防止（取込済み申込の再確認や既存店舗との照合）はサーバー側が引き続き判定する。
 */
export const SALON_RECOVERY_SELECT_PATH = `${SALON_RECOVERY_PATH}?from=handoff`;
/**
 * ログイン・登録後の戻り先が「掲載申込の続き（店舗アカウント作成）」かどうか。
 * /auth/signup はこれが真のとき、来院者向けではなく店舗アカウント作成として表示する。
 */
export function isShopAccountSetupRedirect(redirect: string): boolean {
  const path = redirect.split(/[?#]/)[0];
  return path === '/admin/onboarding' || path === SALON_RECOVERY_PATH;
}
const recoveryContext = z.object({ version: z.literal(1), recoveryId: z.uuid() }).strict();
export function readSalonRecoveryContext(store: Store): string | null {
  try {
    const parsed = recoveryContext.safeParse(JSON.parse(store.getItem(SALON_RECOVERY_CONTEXT_KEY) ?? 'null'));
    return parsed.success ? parsed.data.recoveryId : null;
  } catch { return null; }
}
export function saveSalonRecoveryContext(store: Store, recoveryId: string): boolean {
  const parsed = recoveryContext.safeParse({ version: 1, recoveryId });
  if (!parsed.success) return false;
  try {
    const encoded = JSON.stringify(parsed.data);
    store.setItem(SALON_RECOVERY_CONTEXT_KEY, encoded);
    return store.getItem(SALON_RECOVERY_CONTEXT_KEY) === encoded;
  } catch { return false; }
}

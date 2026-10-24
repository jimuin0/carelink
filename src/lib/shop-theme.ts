/** 利用者向けは青、店舗向けはエクリュ＋ローズブラウン。全ての外枠が同じ判定を使う。 */
export const ECRU_SHOP_PATHS: readonly string[] = ['/register', '/register/complete', '/register/recover'];
const SHARED_AUTH_PATHS: readonly string[] = ['/auth/login', '/auth/signup', '/auth/forgot-password', '/auth/reset-password'];

export function isEcruShopPath(pathname: string | null | undefined, redirect: string | null = null): boolean {
  if (!pathname) return false;
  if (ECRU_SHOP_PATHS.includes(pathname) || pathname === '/admin' || pathname.startsWith('/admin/')) return true;
  if (!SHARED_AUTH_PATHS.includes(pathname) || !redirect) return false;
  // 外部 URL・紛らわしい前方一致は店舗テーマにしない。認証や遷移先の許可判定とは独立。
  const destination = redirect.split(/[?#]/)[0];
  return destination === '/admin' || destination.startsWith('/admin/') || ECRU_SHOP_PATHS.includes(destination);
}

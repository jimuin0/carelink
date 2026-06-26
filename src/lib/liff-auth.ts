/**
 * LIFF（LINE 内ブラウザ）認証ヘルパー。
 *
 * LIFF 文脈は Supabase のセッション Cookie を持たないため、Cookie 認証 API を叩くと必ず 401 に
 * なる。そこで Authorization: Bearer <LINE access token> から本人（アプリの user_id）を解決する。
 *
 * セキュリティ: verifyLineAccessToken で audience（自社 LINE ログインチャネル）を fail-closed で
 * 検証してから /v2/profile を呼ぶ。/v2/profile は発行元チャネルを検証しないため、これを省くと
 * 他チャネル発行トークンで line_user_id を詐称し他人の予約を操作する IDOR が成立する。
 */
import { verifyLineAccessToken } from '@/lib/line';
import { createServiceRoleClient } from '@/lib/supabase-server';

/** リクエストの Authorization ヘッダから Bearer トークンを取り出す（無ければ null）。 */
export function getBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

/**
 * LINE access token からアプリの user_id を解決する。解決できなければ null（呼び出し側で 401）。
 * fail-closed: audience 検証 NG・profile 取得失敗・未連携はすべて null。
 */
export async function resolveLiffUserId(accessToken: string): Promise<string | null> {
  if (!accessToken) return null;

  const tokenCheck = await verifyLineAccessToken(accessToken);
  if (!tokenCheck.ok) return null;

  const res = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;

  const profile = (await res.json()) as { userId?: string };
  if (!profile.userId) return null;

  const admin = createServiceRoleClient();
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('line_user_id', profile.userId)
    .single();
  return data?.id ?? null;
}

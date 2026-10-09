import { verifyLineAccessToken } from '@/lib/line';

export const LIFF_PROFILE_TIMEOUT_MS = 10_000;
export type LiffProfileResult =
  | { ok: true; lineUserId: string; displayName?: string; pictureUrl?: string }
  | { ok: false; status: 401 | 502 | 503; error: string };

/** The server verifies the channel before obtaining identity from LINE itself.
 * Bound the body read too; a late provider response cannot grant access.
 */
export async function fetchVerifiedLiffProfile(accessToken: string): Promise<LiffProfileResult> {
  const token = await verifyLineAccessToken(accessToken);
  if (!token.ok) return { ok: false, status: 401, error: 'Invalid LINE token' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = { ok: false, status: 503, error: 'LINE を確認できません。時間をおいて再確認してください。' } as const;
  const deadline = Date.now() + LIFF_PROFILE_TIMEOUT_MS;
  try {
    const result = await Promise.race([
      (async (): Promise<LiffProfileResult> => {
        const response = await fetch('https://api.line.me/v2/profile', {
          headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) return { ok: false, status: 401, error: 'Invalid LINE token' };
          if (response.status === 429 || response.status >= 500) return unavailable;
          return { ok: false, status: 502, error: 'LINE response invalid' };
        }
        let profile: unknown;
        try { profile = await response.json(); } catch { return { ok: false, status: 502, error: 'LINE response invalid' }; }
        if (!profile || typeof profile !== 'object' || !('userId' in profile) ||
          typeof profile.userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(profile.userId)) {
          return { ok: false, status: 502, error: 'LINE response invalid' };
        }
        return { ok: true, lineUserId: profile.userId,
          ...('displayName' in profile && typeof profile.displayName === 'string' ? { displayName: profile.displayName } : {}),
          ...('pictureUrl' in profile && typeof profile.pictureUrl === 'string' ? { pictureUrl: profile.pictureUrl } : {}),
        };
      })(),
      new Promise<typeof unavailable>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(unavailable); }, LIFF_PROFILE_TIMEOUT_MS);
      }),
    ]);
    return Date.now() >= deadline ? unavailable : result;
  } catch { return unavailable; }
  finally { clearTimeout(timer); }
}

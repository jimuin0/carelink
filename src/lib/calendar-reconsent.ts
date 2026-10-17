import { z } from 'zod';

/** Bound both headers and body reads. No provider exception or credential is
 * forwarded to monitoring by callers. A late response cannot trigger a save. */
export async function calendarGoogleJSON(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error('GOOGLE_CALENDAR_PROVIDER_UNAVAILABLE');
        return response.json() as Promise<unknown>;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('GOOGLE_CALENDAR_PROVIDER_TIMEOUT')), 10_000);
      }),
    ]);
  } finally { clearTimeout(timer); controller.abort(); }
}

async function primary(accessToken: string): Promise<string> {
  const data = await calendarGoogleJSON('https://www.googleapis.com/calendar/v3/calendars/primary', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const id = z.object({ id: z.string().min(1).max(1024) }).parse(data).id;
  if (id === 'primary') throw new Error('GOOGLE_CALENDAR_IDENTITY_UNCONFIRMED');
  return id;
}

/** Prove the existing durable grant belongs to the newly authorized account.
 * Reading an old access token alone would trust potentially mixed legacy data.
 * Only OAuth/token and calendar metadata reads occur; no event write/retry. */
export async function verifiedCalendarRefreshToken(accessToken: string, refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  const data = await calendarGoogleJSON('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const renewed = z.object({ access_token: z.string().min(1), expires_in: z.number().finite().positive(), refresh_token: z.string().min(1).optional() }).parse(data);
  const [authorized, durable] = await Promise.all([primary(accessToken), primary(renewed.access_token)]);
  if (authorized !== durable) throw new Error('GOOGLE_CALENDAR_ACCOUNT_CHANGED');
  return renewed.refresh_token ?? refreshToken;
}

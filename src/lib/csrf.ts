import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

/**
 * CSRF Origin検証。Origin/Refererヘッダーがhostと一致しない場合403を返す。
 * 一致する場合はnullを返す（= 通過OK）。
 */
export function checkCsrf(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');

  // Use Origin header first, fall back to Referer
  const sourceUrl = origin || referer;
  if (!sourceUrl || !host) {
    // No Origin or Referer header — reject non-browser requests
    Sentry.captureMessage('CSRF validation failed: no origin/referer', {
      level: 'warning',
      tags: { feature: 'csrf' },
      extra: { origin, referer, host, url: request.url },
    });
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 403 });
  }

  let sourceHost: string;
  try { sourceHost = new URL(sourceUrl).host; } catch { sourceHost = ''; }
  if (sourceHost !== host) {
    Sentry.captureMessage('CSRF validation failed', {
      level: 'warning',
      tags: { feature: 'csrf' },
      extra: { origin, referer, host, url: request.url },
    });
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 403 });
  }
  return null;
}

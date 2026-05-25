import { NextResponse } from 'next/server';
import { safeCaptureMessage } from './safe';

/**
 * CSRF Origin検証。Origin/Refererヘッダーがhostと一致しない場合403を返す。
 * 一致する場合はnullを返す（= 通過OK）。
 *
 * Sentry 通報は safeCaptureMessage 経由（Sentry 内部 throw で 403 が
 * undefined にならないよう保証する Phase 4 / Layer6 規約）。
 */
export function checkCsrf(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');

  // Use Origin header first, fall back to Referer
  const sourceUrl = origin || referer;
  if (!sourceUrl || !host) {
    // No Origin or Referer header — reject non-browser requests
    safeCaptureMessage('CSRF validation failed: no origin/referer', 'warning', 'csrf', {
      origin, referer, host, url: request.url,
    });
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 403 });
  }

  let sourceHost: string;
  try { sourceHost = new URL(sourceUrl).host; } catch { sourceHost = ''; }
  if (sourceHost !== host) {
    safeCaptureMessage('CSRF validation failed', 'warning', 'csrf', {
      origin, referer, host, url: request.url,
    });
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 403 });
  }
  return null;
}

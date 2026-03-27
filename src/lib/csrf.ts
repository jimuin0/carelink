import { NextResponse } from 'next/server';

/**
 * CSRF Origin検証。Origin/Refererヘッダーがhostと一致しない場合403を返す。
 * 一致する場合はnullを返す（= 通過OK）。
 */
export function checkCsrf(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host && !origin.endsWith(host)) {
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 403 });
  }
  return null;
}

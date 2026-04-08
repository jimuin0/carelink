import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

/**
 * Sentry動作確認用エンドポイント
 *
 * 使い方:
 *   GET /api/sentry-check         → Sentry設定状態を返す（投げない）
 *   GET /api/sentry-check?fire=1  → テストエラーを実際にSentryに投げる
 *
 * セキュリティ: ?fire=1 はSENTRY_TEST_TOKENが一致した場合のみ動作
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fire = url.searchParams.get('fire');
  const token = url.searchParams.get('token');

  const dsnConfigured = !!process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (fire === '1') {
    // テストエラー発火（要トークン）
    const expected = process.env.SENTRY_TEST_TOKEN;
    if (!expected || token !== expected) {
      return NextResponse.json(
        { ok: false, message: 'invalid token' },
        { status: 401 }
      );
    }
    Sentry.captureException(
      new Error(`[CareLink Sentry Test] Fired at ${new Date().toISOString()}`)
    );
    await Sentry.flush(2000);
    return NextResponse.json({
      ok: true,
      fired: true,
      dsnConfigured,
      message: 'Test error sent to Sentry. Check your Sentry dashboard within 1 minute.',
    });
  }

  return NextResponse.json({
    ok: true,
    dsnConfigured,
    environment: process.env.NODE_ENV,
    note: 'To fire a test error: GET /api/sentry-check?fire=1&token=YOUR_SENTRY_TEST_TOKEN',
  });
}

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { timingSafeEqual } from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * Sentry動作確認用エンドポイント
 *
 * 使い方:
 *   GET /api/sentry-check         → Sentry設定状態を返す（投げない）
 *   GET /api/sentry-check?fire=1  → テストエラーを実際にSentryに投げる
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fire = url.searchParams.get('fire');
  const token = url.searchParams.get('token');

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || '';
  const dsnConfigured = !!dsn;

  if (fire === '1') {
    const expected = process.env.SENTRY_TEST_TOKEN;
    const tokenMatch = expected && token
      ? (() => { try { return timingSafeEqual(Buffer.from(token), Buffer.from(expected)); } catch { return false; } })()
      : false;
    if (!tokenMatch) {
      return NextResponse.json(
        { ok: false, message: 'invalid token' },
        { status: 401 }
      );
    }

    // Sentry が未初期化の場合は明示的に初期化（Vercel serverless 対策）
    const client = Sentry.getClient();
    if (!client && dsn) {
      Sentry.init({
        dsn,
        tracesSampleRate: 0.1,
        environment: process.env.NODE_ENV,
      });
    }

    const testError = new Error(
      `[CareLink Sentry Test] Fired at ${new Date().toISOString()}`
    );
    const eventId = Sentry.captureException(testError);

    // flush を長めに待つ（Vercel serverless で送信完了を保証）
    const flushed = await Sentry.flush(5000);

    return NextResponse.json({
      ok: true,
      fired: true,
      dsnConfigured,
      eventId: eventId || null,
      flushed,
      dsn: dsn ? `${dsn.slice(0, 30)}...` : 'NOT SET',
      clientActive: !!Sentry.getClient(),
      message: flushed
        ? 'Sentryにテストエラーが送信されました。1分以内にSentryダッシュボードを確認してください。'
        : 'Sentry flush がタイムアウトしました。DSNまたはネットワークを確認してください。',
    });
  }

  // 初期化状態の詳細診断
  const client = Sentry.getClient();
  return NextResponse.json({
    ok: true,
    dsnConfigured,
    dsn: dsn ? `${dsn.slice(0, 30)}...` : 'NOT SET',
    clientActive: !!client,
    environment: process.env.NODE_ENV,
    note: 'To fire a test error: GET /api/sentry-check?fire=1&token=YOUR_SENTRY_TEST_TOKEN',
  });
}

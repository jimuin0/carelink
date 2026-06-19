import { NextResponse } from 'next/server';
import { notifyRateLimit } from '@/lib/rate-limit';
import { withRoute } from '@/lib/with-route';
import { sendNotify } from '@/lib/notify';

export const dynamic = 'force-dynamic';

export const POST = withRoute(async (request) => {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: '無効なリクエストです' }, { status: 400 });

  const r = await sendNotify(body);
  if (!r.ok) {
    if (r.error === 'invalid_payload') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    if (r.error === 'not_configured') {
      // Phase 7a: Bot Token + chat.postMessage 経由。未設定時は 500
      return NextResponse.json({ error: '通知の送信に失敗しました' }, { status: 500 });
    }
    // 内部 Slack エラーコードはクライアントに返さずサーバーログにのみ記録する（sendNotify 内で記録済み）
    return NextResponse.json({ error: 'Slack通知の送信に失敗しました' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, ts: r.ts });
}, {
  csrf: true,
  rateLimit: { limiter: notifyRateLimit, limit: 5, windowMs: 60_000, prefix: 'notify' },
  sentryTag: 'notify',
});

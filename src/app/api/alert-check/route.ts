import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { alertError } from '@/lib/alert';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 本番アラート配線（Slack #alerts-prod）の自己テストエンドポイント。
 *
 * 背景: Phase 8 で Sentry を廃止し、エラー監視は `instrumentation.ts` の
 * onRequestError → `src/lib/alert.ts`（Slack chat.postMessage）へ完全移行した。
 * 旧 `/api/sentry-check` は廃止済み Sentry 前提で機能しないため、現行 Slack
 * パイプラインをローンチ前にワンショットで疎通確認できる本エンドポイントに置換する。
 *
 * 使い方（神原さん・事務員）:
 *   https://carelink-jp.com/api/alert-check?fire=1&token=<ALERT_CHECK_TOKEN>
 *   → Slack #alerts-prod に 🔴 ERROR [alert-check] ... のテスト通知が届けば疎通OK。
 *
 * セキュリティ: ALERT_CHECK_TOKEN（高エントロピー・Vercel 環境変数）を timing-safe に
 * 照合。未設定なら 500、不一致なら 401。実害のある副作用は Slack 1通のみ。
 */

/** token を定数時間で照合。長さ不一致も必ず false。 */
function tokenValid(actual: string, expected: string): boolean {
  const aBytes = Buffer.from(actual, 'utf8');
  const bBytes = Buffer.from(expected, 'utf8');
  const len = Math.max(aBytes.length, bBytes.length);
  const aBuf = Buffer.alloc(len);
  const bBuf = Buffer.alloc(len);
  aBytes.copy(aBuf);
  bBytes.copy(bBuf);
  return timingSafeEqual(aBuf, bBuf) && aBytes.length === bBytes.length;
}

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.ALERT_CHECK_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { ok: false, message: 'ALERT_CHECK_TOKEN not configured' },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  if (!tokenValid(token, expected)) {
    return NextResponse.json({ ok: false, message: 'invalid token' }, { status: 401 });
  }

  // Slack 側の設定（Bot トークン + 既定チャンネル）が揃っているか。
  // どちらか欠けると alertError はサイレントスキップするため、事前に可視化する。
  const slackConfigured = Boolean(
    process.env.SLACK_BOT_TOKEN && process.env.SLACK_DEFAULT_CHANNEL
  );

  const fire = url.searchParams.get('fire') === '1';
  if (!fire) {
    return NextResponse.json({
      ok: true,
      fired: false,
      slackConfigured,
      message: 'dry check（fire=1 で実際にテスト通知を送信）',
    });
  }

  alertError('[alert-check] 本番アラート配線の疎通テスト（意図的なテスト通知・障害ではありません）', {
    route: '/api/alert-check',
    status: 200,
    commit_sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  });

  return NextResponse.json({
    ok: true,
    fired: true,
    slackConfigured,
    message: slackConfigured
      ? 'テスト通知を Slack へ送信しました。1分以内に #alerts-prod を確認してください。'
      : 'SLACK_BOT_TOKEN / SLACK_DEFAULT_CHANNEL 未設定のため通知はスキップされました（env を設定して再実行）。',
  });
}

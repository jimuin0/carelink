/**
 * POST /api/admin/inquiries/slack-test
 * 運営管理者が、問い合わせの「解決済みにする」ボタンの動作確認用テスト通知を Slack に送る
 * （2026年11月27日 神原さん指示）。ボタンの値は実在しない問い合わせ ID（TEST_INQUIRY_ID）で、
 * 押しても問い合わせは変わらず、押した人の確認結果だけが返る。
 */
import { NextResponse } from 'next/server';
import { withRoute, serverError, type RouteContext } from '@/lib/with-route';
import { postInquiryResolveTestButton } from '@/lib/inquiry-slack-actions';
import { writeAuditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

async function send(_request: Request, ctx: RouteContext) {
  const profile = await ctx.supabase!.from('profiles').select('is_platform_admin').eq('id', ctx.user!.id).maybeSingle();
  if (profile.error !== null) {
    return serverError('admin-inquiries-slack-test-auth', new Error('Admin authorization unavailable'),
      '/api/admin/inquiries/slack-test', 'テスト通知を送れませんでした。');
  }
  if (profile.data?.is_platform_admin !== true) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });

  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-jp.com';
  const ok = await postInquiryResolveTestButton(`${base}/admin/inquiries`);
  if (!ok) return NextResponse.json({ error: 'Slack に送れませんでした。Slack の設定を確認してください。' }, { status: 502, headers });
  void writeAuditLog({ userId: ctx.user!.id, action: 'create', tableName: 'contacts', recordId: null, newValues: { slack_test_notification: true } });
  return NextResponse.json({ ok: true }, { headers });
}

export const POST = withRoute(send, {
  requireAuth: true,
  rateLimit: { limiter: null, limit: 3, windowMs: 10 * 60_000, prefix: 'admin-inquiries-slack-test' },
  sentryTag: 'admin-inquiries-slack-test',
});

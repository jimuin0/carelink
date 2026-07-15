/**
 * 通報 API（v8.15）
 * POST /api/report
 * レビュー・施設・写真の不正報告を受け付ける
 *
 * 【2026年7月15日 要ログイン化】HPB 準拠・通報は会員前提（神原さん確定）。
 * 未認証は withRoute の requireAuth により 401 で遮断。IP 記録・レート制限（5回/分）・
 * 重複ブロック（23505）は維持し、user_id を通報者として記録する。
 */

import { NextResponse } from 'next/server';
import { mutationRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute } from '@/lib/with-route';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const reportSchema = z.object({
  target_type: z.enum(['review', 'facility', 'photo']),
  target_id: z.string().uuid(),
  reason: z.enum(['spam', 'inappropriate', 'fake', 'offensive', 'other']),
  detail: z.string().max(500).optional(),
});

export const POST = withRoute(async (request, ctx) => {
  const ip = getClientIp(request);

  const body = await request.json().catch(() => null);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
  }

  // DB 書き込みは service_role に集約（anon INSERT ポリシー削除後も継続動作・RLS 依存排除）。
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('reports').insert({
    reporter_user_id: ctx.user!.id,
    reporter_ip: ip,
    target_type: parsed.data.target_type,
    target_id: parsed.data.target_id,
    reason: parsed.data.reason,
    detail: parsed.data.detail || null,
  });

  if (error) {
    // 重複通報
    if (error.code === '23505') {
      return NextResponse.json({ error: '既にこの内容を通報済みです' }, { status: 409 });
    }
    return NextResponse.json({ error: '通報に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}, {
  csrf: true,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'report' },
  sentryTag: 'report',
});

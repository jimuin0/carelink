/**
 * コンテンツモデレーション審査 API（v1.0）
 * PATCH /api/admin/moderation/[id]
 * プラットフォーム管理者のみ: moderation_queue の status を更新し、
 * 却下時は対象 facility_reviews の表示ステータスを隠蔽する。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  decision: z.enum(['approved', 'rejected', 'escalated']),
  review_note: z.string().max(500).optional().nullable(),
});

async function getPlatformAdminUser(): Promise<string | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();

  return profile?.is_platform_admin ? user.id : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (inMemoryRateLimit(ip, 10, 60_000, 'admin-moderation-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  // [id] = moderation_queue.id — must be a valid UUID
  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
  }

  const userId = await getPlatformAdminUser();
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const { decision, review_note } = parsed.data;
  const admin = createServiceRoleClient();

  // Fetch the queue item first to validate content_id and get content_type
  const { data: item, error: fetchErr } = await admin
    .from('moderation_queue')
    .select('id, content_type, content_id, status')
    .eq('id', params.id)
    .single();

  if (fetchErr || !item) {
    return NextResponse.json({ error: '対象が見つかりません' }, { status: 404 });
  }

  // Validate content_id is a proper UUID before using it in any secondary query
  if (!UUID_REGEX.test(item.content_id)) {
    return NextResponse.json({ error: 'content_id が不正なUUID形式です' }, { status: 500 });
  }

  // Update moderation_queue
  const { error: updateErr } = await admin
    .from('moderation_queue')
    .update({
      status: decision,
      reviewed_at: new Date().toISOString(),
      review_note: review_note ?? null,
    })
    .eq('id', params.id);

  if (updateErr) {
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
  }

  // 却下の場合: facility_reviews を非表示にする
  // content_id は上でUUID検証済み
  if (decision === 'rejected' && item.content_type === 'review') {
    const { error: hideErr } = await admin
      .from('facility_reviews')
      .update({
        status: 'hidden',
        is_flagged: true,
        flag_reason: review_note || '管理者による非承認',
      })
      .eq('id', item.content_id);
    if (hideErr) {
      console.error('[moderation] review hide failed — review remains visible', { reviewId: item.content_id, err: hideErr });
    }
  }

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId,
    action: decision === 'approved' ? 'approve' : decision === 'rejected' ? 'reject' : 'update',
    tableName: 'moderation_queue',
    recordId: params.id,
    newValues: { decision, content_type: item.content_type, content_id: item.content_id, review_note: review_note ?? null },
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ success: true, decision });
}

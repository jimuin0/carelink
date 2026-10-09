/**
 * コンテンツモデレーション審査 API（v1.0）
 * PATCH /api/admin/moderation/[id]
 * プラットフォーム管理者のみ: moderation_queue の status を更新し、
 * 却下時は対象 facility_reviews の表示ステータスを隠蔽する。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { serverError } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  decision: z.enum(['approved', 'rejected', 'escalated']),
  expected_status: z.enum(['pending', 'approved', 'rejected', 'escalated']).optional(),
  expected_reviewed_at: z.string().datetime({ offset: true }).nullable().optional(),
  review_note: z.string().max(500).optional().nullable(),
});

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    return await moderateContent(request, props);
  } catch (error) {
    return serverError('admin-moderation-dependency', error, '/api/admin/moderation/[id]', '審査結果を保存できませんでした');
  }
}

async function moderateContent(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'admin-moderation-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  // [id] = moderation_queue.id — must be a valid UUID
  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
  }

  const adminUser = await requirePlatformAdmin();
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const userId = adminUser.id;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const { decision, review_note, expected_status, expected_reviewed_at } = parsed.data;
  if (!expected_status || expected_reviewed_at === undefined) return NextResponse.json({ error: '画面を再読み込みし、現在の審査状態を確認してから保存してください' }, { status: 409 });
  const admin = createServiceRoleClient();

  // Fetch the queue item first to validate content_id and get content_type
  const { data: item, error: fetchErr } = await admin
    .from('moderation_queue')
    .select('id, content_type, content_id, status')
    .eq('id', params.id)
    .maybeSingle();

  if (fetchErr) return serverError('admin-moderation-read', fetchErr, '/api/admin/moderation/[id]', '審査対象を確認できませんでした');
  if (!item) {
    return NextResponse.json({ error: '対象が見つかりません' }, { status: 404 });
  }

  // Validate content_id is a proper UUID before using it in any secondary query
  if (!UUID_REGEX.test(item.content_id)) {
    return serverError(
      'admin-moderation-invalid-content-id',
      new Error(`moderation_queue.content_id is not a valid UUID (queue id=${params.id}, content_id=${item.content_id})`),
      '/api/admin/moderation/[id]',
      'content_id が不正なUUID形式です',
    );
  }

  // Final authorization, the decision and review visibility belong to one
  // transaction. A lost HTTP response may replay the exact same decision;
  // a different concurrent decision must be read again before saving.
  const { data: updatedRows, error: updateErr } = await admin
    .rpc('moderate_content_atomic', {
      p_actor_id: userId,
      p_queue_id: params.id,
      p_expected_status: expected_status,
      p_expected_reviewed_at: expected_reviewed_at,
      p_decision: decision,
      p_review_note: review_note ?? null,
    });

  if (updateErr?.message.includes('MODERATION_PERMISSION_REVOKED')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (updateErr?.message.includes('MODERATION_REVISION_CONFLICT')) return NextResponse.json({ error: '審査状態が変更されています。再読み込みしてください' }, { status: 409 });
  if (updateErr?.message.includes('MODERATION_REVIEW_UNAVAILABLE')) return NextResponse.json({ error: '対象レビューを確認できません。審査結果は保存されていません' }, { status: 409 });
  if (updateErr) {
    return serverError('admin-moderation-update', updateErr, '/api/admin/moderation/[id]', '更新に失敗しました');
  }
  if (updatedRows?.length === 0) {
    return NextResponse.json({ error: '対象が見つかりません' }, { status: 404 });
  }

  if (updatedRows?.length !== 1 || updatedRows[0].id !== params.id) return serverError('admin-moderation-result', new Error('Moderation commit not confirmed'), '/api/admin/moderation/[id]', '審査結果の保存を確認できませんでした');
  const updated = updatedRows[0];

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId,
    action: decision === 'approved' ? 'approve' : decision === 'rejected' ? 'reject' : 'update',
    tableName: 'moderation_queue',
    recordId: params.id,
    newValues: { decision, content_type: updated.content_type, content_id: updated.content_id, review_note: review_note ?? null, replayed: updated.replayed },
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ success: true, decision });
}

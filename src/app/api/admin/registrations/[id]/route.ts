/**
 * 施設登録審査 API（v1.0）
 * PATCH /api/admin/registrations/[id]
 * プラットフォーム管理者のみ: salons テーブルの status を更新する
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { serverError } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  status: z.enum(['approved', 'rejected', 'pending']),
  expected_status: z.string().max(100).nullable().default('pending'),
  expected_revision: z.number().int().min(0).max(2147483647),
}).strict();

async function getPlatformAdminUser(): Promise<string | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();

  if (error !== null) throw new Error('Registration authorization unavailable');
  return profile?.is_platform_admin === true ? user.id : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const response = await patch(request, props);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    const response = serverError('admin-registrations-patch', new Error('Registration update dependency failure'),
      '/api/admin/registrations/[id]', '更新結果を確認できません。一覧を再読み込みしてください。');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

async function patch(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'admin-registrations-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);

  // 【2026年8月20日 新設】運営による claim 解除。Cookie による所有権 claim
  // （src/lib/salon-claim.ts）は復旧手段の無い一方向の消費のため、誤 claim・不正 claim を
  // 本番に出さないための運営導線を用意する。DB上のplatform adminで
  // 保護し、writeAuditLog で記録する。
  if (body && typeof body === 'object' && (body as { action?: unknown }).action === 'unclaim') {
    const adminUserId = await getPlatformAdminUser();
    if (!adminUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const admin = createServiceRoleClient();
    const { data: existing, error: fetchErr } = await admin
      .from('salons')
      .select('id, claimed_by_user_id, claimed_at, claimed_facility_id')
      .eq('id', params.id)
      .maybeSingle();

    if (fetchErr) {
      return serverError('admin-registrations-unclaim-fetch', new Error('Registration claim read failed'), '/api/admin/registrations/[id]', '更新に失敗しました');
    }
    if (!existing) {
      return NextResponse.json({ error: '登録が見つかりません' }, { status: 404 });
    }
    if (existing.claimed_facility_id !== null) {
      return NextResponse.json({ error: '施設への取り込み済み申込です。所有者・写真・通知を含む整合した復旧が必要なため、ここでは解除できません。' }, { status: 409 });
    }

    let update = admin
      .from('salons')
      .update({ claimed_by_user_id: null, claimed_at: null })
      .eq('id', params.id)
      .is('claimed_facility_id', null);
    update = existing.claimed_by_user_id === null
      ? update.is('claimed_by_user_id', null) : update.eq('claimed_by_user_id', existing.claimed_by_user_id);
    update = existing.claimed_at === null
      ? update.is('claimed_at', null) : update.eq('claimed_at', existing.claimed_at);
    const { data: updatedRows, error: updateErr } = await update.select('id');

    if (updateErr) {
      return serverError('admin-registrations-unclaim-update', new Error('Registration claim update failed'), '/api/admin/registrations/[id]', '更新に失敗しました');
    }
    if (updatedRows?.length !== 1) {
      return NextResponse.json({ error: '申込の状態が変わりました。再読込して確認してください。' }, { status: 409 });
    }

    const { ua } = getRequestContext(request);
    void writeAuditLog({
      userId: adminUserId,
      action: 'update',
      tableName: 'salons',
      recordId: params.id,
      oldValues: { claimed_by_user_id: existing.claimed_by_user_id, claimed_at: existing.claimed_at },
      newValues: { claimed_by_user_id: null, claimed_at: null },
      ipAddress: ip,
      userAgent: ua,
    });

    return NextResponse.json({ success: true });
  }

  const userId = await getPlatformAdminUser();
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  // Compare the observed state atomically. A stale browser/another reviewer must
  // not overwrite a completed decision. Zero rows can mean absent or changed.
  let update = admin
    .from('salons')
    .update({ status: parsed.data.status })
    .eq('id', params.id)
    .eq('review_revision', parsed.data.expected_revision);
  update = parsed.data.expected_status === null
    ? update.is('status', null) : update.eq('status', parsed.data.expected_status);
  const { data, error } = await update.select('id');

  if (error) {
    return serverError('admin-registrations-patch', new Error('Registration status update failed'), '/api/admin/registrations/[id]', '更新に失敗しました');
  }
  if (!data || data.length !== 1) {
    return NextResponse.json({ error: '申込が存在しないか、状態が変更されています。一覧を再読み込みしてください。' }, { status: 409 });
  }

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId,
    action: parsed.data.status === 'approved' ? 'approve' : parsed.data.status === 'rejected' ? 'reject' : 'update',
    tableName: 'salons',
    recordId: params.id,
    newValues: { status: parsed.data.status },
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ success: true, status: parsed.data.status });
}

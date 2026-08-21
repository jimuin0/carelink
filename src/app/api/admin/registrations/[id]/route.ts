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
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { serverError } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  status: z.enum(['approved', 'rejected', 'pending']),
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
  if (await checkRateLimit(null, ip, 10, 60_000, 'admin-registrations-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);

  // 【2026年8月20日 新設】運営による claim 解除。Cookie による所有権 claim
  // （src/lib/salon-claim.ts）は復旧手段の無い一方向の消費のため、誤 claim・不正 claim を
  // 本番に出さないための運営導線を用意する。requirePlatformAdmin（単一ソース・DBカラム方式）で
  // 保護し、writeAuditLog で記録する。
  if (body && typeof body === 'object' && (body as { action?: unknown }).action === 'unclaim') {
    const adminUser = await requirePlatformAdmin();
    if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const admin = createServiceRoleClient();
    const { data: existing, error: fetchErr } = await admin
      .from('salons')
      .select('id, claimed_by_user_id, claimed_at')
      .eq('id', params.id)
      .maybeSingle();

    if (fetchErr) {
      return serverError('admin-registrations-unclaim-fetch', fetchErr, '/api/admin/registrations/[id]', '更新に失敗しました');
    }
    if (!existing) {
      return NextResponse.json({ error: '登録が見つかりません' }, { status: 404 });
    }

    const { error: updateErr } = await admin
      .from('salons')
      .update({ claimed_by_user_id: null, claimed_at: null })
      .eq('id', params.id);

    if (updateErr) {
      return serverError('admin-registrations-unclaim-update', updateErr, '/api/admin/registrations/[id]', '更新に失敗しました');
    }

    const { ua } = getRequestContext(request);
    void writeAuditLog({
      userId: adminUser.id,
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
  // .select() で更新行を受け取り 0 行なら 404。旧実装は .select() が無く、存在しない id への
  // 更新も 0 行更新のまま { success:true } を返し、実在しない登録に対して「承認」の監査ログを
  // 残していた（phantom success）。実際に更新された行だけを成功・監査対象とする。
  const { data, error } = await admin
    .from('salons')
    .update({ status: parsed.data.status })
    .eq('id', params.id)
    .select('id');

  if (error) {
    return serverError('admin-registrations-patch', error, '/api/admin/registrations/[id]', '更新に失敗しました');
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: '登録が見つかりません' }, { status: 404 });
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

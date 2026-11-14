import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { serverError, authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  price: z.number().int().min(0).max(9999999).optional(),
  sessions_per_month: z.number().int().min(1).max(100).optional(),
  valid_months: z.number().int().min(1).max(24).optional(),
  notes: z.string().max(500).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

/** 権限確認。null＝権限なし（403）。DB 障害は 500 の応答を返す（中 A12）。 */
async function verifyAdmin(planId: string, userId: string): Promise<string | NextResponse | null> {
  const admin = createServiceRoleClient();
  const { data: plan, error: planError } = await admin.from('subscription_plans').select('facility_id').eq('id', planId).single();
  if (planError && planError.code !== 'PGRST116') return serverError('admin-subscription-plans-id-read', planError, '/api/admin/subscription-plans/[id]');
  if (!plan) return null;

  const supabase = await createServerSupabaseAuthClient();
  const { data: mem, error: memError } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .eq('facility_id', plan.facility_id)
    .in('role', ['owner', 'admin'])
    .single();
  if (memError && memError.code !== 'PGRST116') return serverError('admin-subscription-plans-id-membership', memError, '/api/admin/subscription-plans/[id]');

  return mem ? plan.facility_id : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'subscription-plans-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const supabase = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('admin-subscription-plans-id-auth', '/api/admin/subscription-plans/[id]');
  if (verification.state !== 'verified') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = verification.user;

  const facilityId = await verifyAdmin(params.id, user.id);
  if (facilityId instanceof NextResponse) return facilityId;
  if (!facilityId) return NextResponse.json({ error: '権限がありません' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('subscription_plans').update(parsed.data).eq('id', params.id).eq('facility_id', facilityId).select().maybeSingle();

  if (error) return serverError('admin-subscription-plans-patch', error, '/api/admin/subscription-plans/[id]');
  if (!data) return NextResponse.json({ error: 'プランが見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'update',
    tableName: 'subscription_plans',
    recordId: params.id,
    newValues: parsed.data,
    ipAddress: ip,
  });

  return NextResponse.json({ plan: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'subscription-plans-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const supabase = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('admin-subscription-plans-id-auth', '/api/admin/subscription-plans/[id]');
  if (verification.state !== 'verified') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = verification.user;

  const facilityId = await verifyAdmin(params.id, user.id);
  if (facilityId instanceof NextResponse) return facilityId;
  if (!facilityId) return NextResponse.json({ error: '権限がありません' }, { status: 403 });

  const admin = createServiceRoleClient();

  // 契約中ユーザーがいる場合は無効化のみ
  const { count, error: countErr } = await admin.from('user_subscriptions').select('id', { count: 'exact', head: true }).eq('plan_id', params.id).eq('status', 'active');
  if (countErr) return serverError('admin-subscription-plans-delete-count', countErr, '/api/admin/subscription-plans/[id]');
  // 件数を確認できない（count=null）ときは「契約者なし」とみなさず、無効化だけにとどめる（点検 A70）。
  if (count === null || count === undefined || count > 0) {
    // 更新件数(affected rows)を検証せず常に成功を返していたため、TOCTOU（契約中ユーザー確認後に
    // 既削除等）による0件更新も「成功」と偽装していた（phantom success）。.select() で更新行を受け取り、
    // 0件なら404を返す（packages/[id]・catalog/[id] と同型）。
    const { data: deactivated, error: deactivateErr } = await admin
      .from('subscription_plans')
      .update({ is_active: false })
      .eq('id', params.id)
      .eq('facility_id', facilityId)
      .select();
    if (deactivateErr) return serverError('admin-subscription-plans-delete-deactivate', deactivateErr, '/api/admin/subscription-plans/[id]');
    if (!deactivated || deactivated.length === 0) return NextResponse.json({ error: 'プランが見つかりません' }, { status: 404 });
    // 削除の代わりに無効化した場合も監査ログに残す（B2-8）。
    void writeAuditLog({
      userId: user.id,
      facilityId,
      action: 'update',
      tableName: 'subscription_plans',
      recordId: params.id,
      newValues: { is_active: false },
      ipAddress: ip,
    });
    return NextResponse.json({ message: '契約中ユーザーがいるため非公開にしました' });
  }

  // 削除件数(affected rows)を検証せず常に成功を返していたため、TOCTOU（契約中ユーザー確認後に
  // 既削除等）による0件削除も「成功」と偽装していた（phantom success）。.select() で削除行を受け取り、
  // 0件なら404を返す。
  const { data, error } = await admin.from('subscription_plans').delete().eq('id', params.id).eq('facility_id', facilityId).select();
  if (error) return serverError('admin-subscription-plans-delete', error, '/api/admin/subscription-plans/[id]');
  if (!data || data.length === 0) return NextResponse.json({ error: 'プランが見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'delete',
    tableName: 'subscription_plans',
    recordId: params.id,
    ipAddress: ip,
  });

  return NextResponse.json({ message: 'deleted' });
}

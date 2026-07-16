import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  menu_id: z.string().uuid().nullable().optional(),
  session_count: z.number().int().min(1).max(100).optional(),
  bonus_count: z.number().int().min(0).max(50).optional(),
  price: z.number().int().min(0).optional(),
  valid_days: z.number().int().min(1).max(3650).optional(),
  notes: z.string().max(500).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

async function getAdminAndVerifyPackage(request: NextRequest, packageId: string): Promise<{ facilityId: string; userId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createServiceRoleClient();
  const { data: pkg } = await admin.from('service_packages').select('facility_id').eq('id', packageId).single();
  if (!pkg) return null;

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .eq('facility_id', pkg.facility_id)
    .in('role', ['owner', 'admin'])
    .single();

  return membership ? { facilityId: pkg.facility_id, userId: user.id } : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'packages-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const auth = await getAdminAndVerifyPackage(request, params.id);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();

  // menu_id を指定する場合は、自施設の facility_menus に属することを検証する
  // （他施設の menu_id を関連付ける越境参照を防止）
  if (parsed.data.menu_id) {
    const { data: menu } = await admin
      .from('facility_menus')
      .select('id')
      .eq('id', parsed.data.menu_id)
      .eq('facility_id', auth.facilityId)
      .single();
    if (!menu) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  // .maybeSingle(): verify と update の間に削除される TOCTOU 等で該当0行になった場合、.single() だと
  // PGRST116 error が先に発火し if(error)→500 になり 404 分岐が到達不能になる（catalog/coupons/
  // subscription-plans の同型 [id] ルートと統一）。
  const { data, error } = await admin.from('service_packages').update(parsed.data).eq('id', params.id).eq('facility_id', auth.facilityId).select().maybeSingle();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'パッケージが見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'update',
    tableName: 'service_packages',
    recordId: params.id,
    newValues: parsed.data,
    ipAddress: ip,
  });

  return NextResponse.json({ package: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'packages-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const auth = await getAdminAndVerifyPackage(request, params.id);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  // 購入済みユーザーがいる場合は無効化のみ（削除しない）
  const { count, error: countErr } = await admin.from('user_packages').select('id', { count: 'exact', head: true }).eq('package_id', params.id);
  if (countErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (count && count > 0) {
    // 更新件数(affected rows)を検証せず常に成功を返していたため、TOCTOU（購入済みユーザー確認後に
    // 既削除等）による0件更新も「成功」と偽装していた（phantom success）。.select() で更新行を受け取り、
    // 0件なら404を返す（customers/[id]・menus/[id]・catalog/[id] と同型）。
    const { data: deactivated, error: deactivateErr } = await admin
      .from('service_packages')
      .update({ is_active: false })
      .eq('id', params.id)
      .eq('facility_id', auth.facilityId)
      .select();
    if (deactivateErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    if (!deactivated || deactivated.length === 0) return NextResponse.json({ error: 'パッケージが見つかりません' }, { status: 404 });
    return NextResponse.json({ message: '購入済みユーザーがいるため非公開にしました' });
  }

  // 削除件数(affected rows)を検証せず常に成功を返していたため、TOCTOU（購入済みユーザー確認後に
  // 既削除等）による0件削除も「成功」と偽装していた（phantom success）。.select() で削除行を受け取り、
  // 0件なら404を返す。
  const { data, error } = await admin.from('service_packages').delete().eq('id', params.id).eq('facility_id', auth.facilityId).select();
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: 'パッケージが見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'delete',
    tableName: 'service_packages',
    recordId: params.id,
    ipAddress: ip,
  });

  return NextResponse.json({ message: 'deleted' });
}

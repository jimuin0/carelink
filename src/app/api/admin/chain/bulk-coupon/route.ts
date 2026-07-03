/**
 * POST /api/admin/chain/bulk-coupon
 * チェーン全施設に同一クーポンを一括発行
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { UUID_REGEX } from '@/lib/constants';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 10, 60_000, 'bulk-coupon')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, coupon_type, discount_type, discount_value, special_price, valid_from, valid_until, facility_ids } = await req.json().catch(() => ({}));

  if (!name || !discount_type || !facility_ids?.length) {
    return NextResponse.json({ error: 'name, discount_type, facility_ids are required' }, { status: 400 });
  }
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
    return NextResponse.json({ error: 'name must be 1-100 characters' }, { status: 400 });
  }
  // 【正準値】単体発行(admin/coupons)・予約時の割引適用(booking/route.ts)・DB CHECK 制約
  // (coupons.discount_type IN ('fixed','percentage','special_price')) と完全一致させる。
  // 旧値 'percent'/'special' は DB CHECK 違反で INSERT が必ず 500 になり一括発行が不能だった
  // （かつ仮に通っても予約時の分岐にマッチせず無割引になる）。
  const VALID_DISCOUNT_TYPES = ['fixed', 'percentage', 'special_price'];
  if (!VALID_DISCOUNT_TYPES.includes(discount_type)) {
    return NextResponse.json({ error: 'Invalid discount_type' }, { status: 400 });
  }
  if (!Array.isArray(facility_ids) || facility_ids.length > 50) {
    return NextResponse.json({ error: 'facility_ids must be array of at most 50' }, { status: 400 });
  }
  if (!facility_ids.every((id: unknown) => typeof id === 'string' && UUID_REGEX.test(id))) {
    return NextResponse.json({ error: 'Invalid facility_ids' }, { status: 400 });
  }
  if (discount_value !== undefined && discount_value !== null && (typeof discount_value !== 'number' || discount_value < 0)) {
    return NextResponse.json({ error: 'discount_value must be a non-negative number' }, { status: 400 });
  }
  if (special_price !== undefined && special_price !== null && (typeof special_price !== 'number' || special_price < 0)) {
    return NextResponse.json({ error: 'special_price must be a non-negative number' }, { status: 400 });
  }
  // 上限バリデーション（単体発行 admin/coupons と同一）。欠落していると percentage>100 で
  // マイナス価格方向の割引や過大な special_price を一括で作れてしまう。
  // discount_value/special_price は上の非負チェック通過時点で数値か null/undefined のみ
  // （null/undefined > n は false）なので typeof ガードは不要。
  if (discount_type === 'percentage' && discount_value > 100) {
    return NextResponse.json({ error: 'percentage discount_value must be 0-100' }, { status: 400 });
  }
  if (discount_value > 100000) {
    return NextResponse.json({ error: 'discount_value must be at most 100000' }, { status: 400 });
  }
  if (special_price > 9999999) {
    return NextResponse.json({ error: 'special_price must be at most 9999999' }, { status: 400 });
  }

  // 権限確認: 全施設に対してowner/adminであること
  const admin = createServiceRoleClient();
  const { data: memberships } = await admin
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .in('facility_id', facility_ids);

  const allowedIds = (memberships ?? []).map((m) => m.facility_id);
  if (allowedIds.length !== facility_ids.length) {
    return NextResponse.json({ error: 'Forbidden: some facilities not authorized' }, { status: 403 });
  }

  const rows = facility_ids.map((fid: string) => ({
    facility_id: fid,
    name: name.trim(),
    // 正準値（DB CHECK: coupon_type IN ('new_customer','repeat','limited_time','all')）に合わせる。
    // 旧値 'first_visit'/'birthday' は CHECK 違反、逆に有効値 'new_customer' 等は旧 includes に
    // 無く黙って 'all' に落ちていた。非該当は 'all' フォールバック（従来同様）。
    coupon_type: ['all', 'new_customer', 'repeat', 'limited_time'].includes(coupon_type) ? coupon_type : 'all',
    discount_type,
    discount_value: discount_value ?? null,
    special_price: special_price ?? null,
    valid_from: valid_from || null,
    valid_until: valid_until || null,
    is_active: true,
  }));

  const { data, error } = await admin.from('coupons').insert(rows).select('id');
  if (error) return NextResponse.json({ error: 'クーポン作成に失敗しました' }, { status: 500 });

  const { ip: auditIp, ua } = getRequestContext(req);
  void writeAuditLog({
    userId: user.id,
    action: 'create',
    tableName: 'coupons',
    newValues: { name: name.trim(), discount_type, facility_ids, count: data?.length ?? 0 },
    ipAddress: auditIp,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true, created: data?.length ?? 0 }, { status: 201 });
}

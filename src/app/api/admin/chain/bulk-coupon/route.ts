/**
 * POST /api/admin/chain/bulk-coupon
 * チェーン全施設に同一クーポンを一括発行
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { UUID_REGEX } from '@/lib/constants';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'bulk-coupon')) {
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
  const VALID_DISCOUNT_TYPES = ['percent', 'fixed', 'special'];
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

  // API契約の値を coupons テーブルの CHECK 制約語彙へマッピング（不一致は CHECK 違反で500の原因）
  // discount_type CHECK: ('fixed','percentage','special_price')
  const DISCOUNT_MAP: Record<string, string> = { percent: 'percentage', fixed: 'fixed', special: 'special_price' };
  // coupon_type CHECK: ('new_customer','repeat','limited_time','all')。first_visit→new_customer、birthday は対応値が無いため all。
  const COUPON_TYPE_MAP: Record<string, string> = { first_visit: 'new_customer', birthday: 'all', all: 'all' };
  const dbDiscountType = DISCOUNT_MAP[discount_type] ?? 'fixed';
  const dbCouponType = COUPON_TYPE_MAP[coupon_type] ?? 'all';

  const rows = facility_ids.map((fid: string) => ({
    facility_id: fid,
    name: name.trim(),
    coupon_type: dbCouponType,
    discount_type: dbDiscountType,
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

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';

const VALID_COUPON_TYPES = ['all', 'new_customer', 'repeat', 'limited_time'] as const;
const VALID_DISCOUNT_TYPES = ['fixed', 'percentage', 'special_price'] as const;

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  coupon_type: z.enum(VALID_COUPON_TYPES).optional(),
  discount_type: z.enum(VALID_DISCOUNT_TYPES).optional(),
  discount_value: z.number().int().min(0).max(100000).optional().nullable(),
  special_price: z.number().int().min(0).max(9999999).optional().nullable(),
  valid_from: z.string().nullable().optional(),
  valid_until: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
}).refine(
  (data) => !(data.discount_type === 'percentage' && data.discount_value != null && data.discount_value > 100),
  { message: 'percentage discount_value must be 0-100', path: ['discount_value'] },
);

async function verifyCouponAdmin(couponId: string, userId: string): Promise<string | null> {
  const admin = createServiceRoleClient();
  const { data: coupon } = await admin.from('coupons').select('facility_id').eq('id', couponId).single();
  if (!coupon) return null;

  const supabase = await createServerSupabaseAuthClient();
  const { data: mem } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .eq('facility_id', coupon.facility_id)
    .in('role', ['owner', 'admin'])
    .single();

  return mem ? coupon.facility_id : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (inMemoryRateLimit(ip, 20, 60_000, 'coupons-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await verifyCouponAdmin(params.id, user.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  // Include facility_id in WHERE as defence-in-depth (CAS guard against stale verifyCouponAdmin read)
  const { data, error } = await admin.from('coupons').update(parsed.data).eq('id', params.id).eq('facility_id', facilityId).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'クーポンが見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'update',
    tableName: 'coupons',
    recordId: params.id,
    newValues: parsed.data,
    ipAddress: ip,
  });

  return NextResponse.json({ coupon: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (inMemoryRateLimit(ip, 10, 60_000, 'coupons-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await verifyCouponAdmin(params.id, user.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  // Include facility_id in WHERE as defence-in-depth (CAS guard against stale verifyCouponAdmin read)
  const { error } = await admin.from('coupons').delete().eq('id', params.id).eq('facility_id', facilityId);
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'delete',
    tableName: 'coupons',
    recordId: params.id,
    ipAddress: ip,
  });

  return NextResponse.json({ message: 'deleted' });
}

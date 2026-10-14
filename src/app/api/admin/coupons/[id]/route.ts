import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { validateCouponDiscountFields, normalizeCouponDiscountFields } from '@/lib/coupon-validation';
import { serverError } from '@/lib/with-route';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { verifyAuthUser, AUTH_UNAVAILABLE_BODY } from '@/lib/auth-verification';

const VALID_COUPON_TYPES = ['all', 'new_customer', 'repeat', 'limited_time'] as const;
const VALID_DISCOUNT_TYPES = ['fixed', 'percentage', 'special_price'] as const;

// 【2026年7月15日 HPB準拠仕様・zod強化】validateCouponDiscountFields（src/lib/coupon-validation.ts・
// POST側と共有のSSOT）で discount_type×値の相互必須を強制する。部分更新（PATCH）のため
// discount_type は optional だが、discount_value/special_price を送る場合は discount_type の
// 同時指定を必須にする（型が不明なまま値だけ更新すると percentage 150% 等が素通りするため）。
// transform で型に対応しない側の列を null へ正規化（discount_type 未指定時は値列に一切触れない）。
// target_menu_ids＝対象メニュー限定の同期（coupon_menus を delete→insert）。未指定＝同期しない・
// 空配列＝限定解除（全メニュー適用へ）。
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
  target_menu_ids: z.array(z.string().uuid()).max(100).optional(),
}).superRefine(validateCouponDiscountFields).transform(normalizeCouponDiscountFields);

async function verifyCouponAdmin(couponId: string, userId: string): Promise<string | null> {
  const admin = createServiceRoleClient();
  const { data: coupon, error: couponError } = await admin.from('coupons').select('facility_id').eq('id', couponId).maybeSingle();
  if (couponError) throw databaseDiagnostic(couponError);
  if (!coupon) return null;

  const supabase = await createServerSupabaseAuthClient();
  const { data: mem, error: memberError } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .eq('facility_id', coupon.facility_id)
    .in('role', ['owner', 'admin'])
    .maybeSingle();
  if (memberError) throw databaseDiagnostic(memberError);

  return mem ? coupon.facility_id : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'coupons-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return NextResponse.json(AUTH_UNAVAILABLE_BODY, { status: 503 });
  if (identity.state !== 'verified') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = identity.user;
  let facilityId: string | null;
  try { facilityId = await verifyCouponAdmin(params.id, user.id); }
  catch (error) { return serverError('admin-coupons-access', error, '/api/admin/coupons/[id]'); }
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  // target_menu_ids は coupons テーブルの列ではない（coupon_menus へ delete→insert で同期）ため
  // coupons UPDATE の payload から分離する。
  const { target_menu_ids: targetMenuIds, ...couponFields } = parsed.data;

  const admin = createServiceRoleClient();

  const { data: saved, error } = await admin.rpc('save_admin_coupon_atomic', {
    p_actor_id: user.id, p_facility_id: facilityId, p_coupon_id: params.id,
    p_fields: couponFields, p_target_menu_ids: targetMenuIds ?? null,
  });
  if (error?.code === '42501') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (error?.code === '22023') return NextResponse.json({ error: 'クーポンまたは対象メニューが不正です' }, { status: 400 });
  if (error) return serverError('admin-coupons-patch', databaseDiagnostic(error), '/api/admin/coupons/[id]');
  const data = saved?.[0];
  if (!data) return NextResponse.json({ error: 'クーポンが見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'update',
    tableName: 'coupons',
    recordId: params.id,
    newValues: { ...couponFields, ...(targetMenuIds !== undefined ? { target_menu_ids: targetMenuIds } : {}) },
    ipAddress: ip,
  });

  return NextResponse.json({ coupon: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'coupons-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return NextResponse.json(AUTH_UNAVAILABLE_BODY, { status: 503 });
  if (identity.state !== 'verified') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = identity.user;
  let facilityId: string | null;
  try { facilityId = await verifyCouponAdmin(params.id, user.id); }
  catch (error) { return serverError('admin-coupons-access', error, '/api/admin/coupons/[id]'); }
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  const {data:results,error}=await admin.rpc('retire_admin_coupon_atomic',{
    p_actor_id:user.id,p_facility_id:facilityId,p_coupon_id:params.id,
  });
  if(error?.code==='42501')return NextResponse.json({error:'Unauthorized'},{status:401});
  if(error)return serverError('admin-coupons-retire',databaseDiagnostic(error),'/api/admin/coupons/[id]');
  const result=results?.[0];
  if(!result)return NextResponse.json({error:'クーポンが見つかりません'},{status:404});
  if(result.coupon_id!==params.id.toLowerCase() || result.facility_id!==facilityId || !['deactivated','deleted'].includes(result.outcome))
    return serverError('admin-coupons-retire-receipt',new Error('COUPON_RETIRE_RECEIPT_INVALID'),'/api/admin/coupons/[id]');
  const deactivated=result.outcome==='deactivated';
  void writeAuditLog({userId:user.id,facilityId,action:deactivated?'update':'delete',tableName:'coupons',recordId:params.id,
    ...(deactivated?{newValues:{is_active:false}}:{}),ipAddress:ip});
  return NextResponse.json({message:deactivated?'利用記録または予約があるため無効化しました':'deleted'});
}

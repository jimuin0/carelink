import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { UUID_REGEX } from '@/lib/constants';
import { randomUUID } from 'node:crypto';
import { couponSavedResult } from '@/lib/coupon-operation-result';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { validateCouponDiscountFields, normalizeCouponDiscountFields, validateCouponDates, normalizeCouponDateFields } from '@/lib/coupon-validation';
import { serverError } from '@/lib/with-route';

const VALID_COUPON_TYPES = ['all', 'new_customer', 'repeat', 'limited_time'] as const;
const VALID_DISCOUNT_TYPES = ['fixed', 'percentage', 'special_price'] as const;

// 【2026年7月15日 HPB準拠仕様・zod強化】従来は discount_type と discount_value/special_price の
// 相互必須が無く、fixed+discount_value null（0円引き扱い）等の不整合クーポンが作成できてしまって
// いた（本番金銭バグの根本原因）。validateCouponDiscountFields（src/lib/coupon-validation.ts・
// PATCH側と共有のSSOT）で fixed→discount_value 1〜100000必須・percentage→discount_value 1〜100
// 必須・special_price→special_price 1〜9999999必須を強制し、transform で型に対応しない側の列を
// null へ正規化する。0円引き/0%OFF/¥0特別価格は作成不可。
// target_menu_ids＝対象メニュー限定（coupon_menus へ保存）。空配列/未指定＝限定なし（全メニュー適用）。
const couponSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  coupon_type: z.enum(VALID_COUPON_TYPES).default('all'),
  discount_type: z.enum(VALID_DISCOUNT_TYPES),
  discount_value: z.number().int().min(0).max(100000).optional().nullable(),
  special_price: z.number().int().min(0).max(9999999).optional().nullable(),
  valid_from: z.string().nullable().optional(),
  valid_until: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  target_menu_ids: z.array(z.string().uuid()).max(100).optional(),
}).superRefine(validateCouponDiscountFields).superRefine(validateCouponDates).transform(data=>normalizeCouponDateFields(normalizeCouponDiscountFields(data)));

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'coupons-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminApiContext(request);
  if (auth instanceof NextResponse) return auth;

  const operation=request.nextUrl.searchParams.get('operation_id');
  if(operation!==null){
    const kind=request.nextUrl.searchParams.get('kind');
    const coupon=request.nextUrl.searchParams.get('coupon_id');
    if(!UUID_REGEX.test(operation) || !['create','update','retire'].includes(kind ?? '')
      || (kind==='create' ? coupon!==null : coupon===null || !UUID_REGEX.test(coupon)))
      return NextResponse.json({error:'Invalid operation'},{status:400});
    const {data:state,error}=await createServiceRoleClient().rpc('get_admin_coupon_operation',{
      p_actor_id:auth.userId,p_facility_id:auth.facilityId,p_operation_id:operation,p_kind:kind!,p_coupon_id:coupon,
    });
    if(error)return serverError('admin-coupons-operation-read',databaseDiagnostic(error),'/api/admin/coupons');
    if(!['absent','saved','retired'].includes(state ?? ''))return serverError('admin-coupons-operation-state',new Error('COUPON_OPERATION_STATE_INVALID'),'/api/admin/coupons');
    return NextResponse.json({state});
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('coupons')
    .select('*')
    .eq('facility_id', auth.facilityId)
    .order('created_at', { ascending: false });

  if (error) return serverError('admin-coupons-list', databaseDiagnostic(error), '/api/admin/coupons');
  return NextResponse.json({ coupons: data });
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'coupons-create')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminApiContext(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = couponSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const { target_menu_ids: targetMenuIds, ...couponData } = parsed.data;
  const admin = createServiceRoleClient();
  const operationId=request.headers.get('Idempotency-Key') ?? randomUUID();
  if(!UUID_REGEX.test(operationId))return NextResponse.json({error:'Invalid operation'},{status:400});
  const {data:result,error}=await admin.rpc('manage_admin_coupon_with_receipt_atomic',{
    p_actor_id:auth.userId,p_facility_id:auth.facilityId,p_coupon_id:null,p_operation_id:operationId,p_kind:'create',
    p_fields:couponData,p_target_menu_ids:targetMenuIds ?? [],
  });
  if(error?.code==='42501')return NextResponse.json({error:'Unauthorized'},{status:401});
  if(error?.code==='22023')return NextResponse.json({error:'クーポンまたは対象メニューが不正です'},{status:400});
  if(error?.code==='23505')return NextResponse.json({error:'この操作は別の入力で保存済みです。一覧で保存内容を確認してください。'},{status:409});
  if(error?.code==='P0002')return NextResponse.json({error:'この操作のクーポンは削除済みです。一覧で確認してください。'},{status:410});
  if(error)return serverError('admin-coupons-create',databaseDiagnostic(error),'/api/admin/coupons');
  let receipt:ReturnType<typeof couponSavedResult>;
  try{receipt=couponSavedResult(result,auth.facilityId);}catch(error){return serverError('admin-coupons-create-receipt',error,'/api/admin/coupons');}
  const data=receipt.coupon;

  const { ua } = getRequestContext(request);
  if(!receipt.wasReplay)void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'create',
    tableName: 'coupons',
    recordId: data.id,
    newValues: {
      name: couponData.name,
      discount_type: couponData.discount_type,
      discount_value: couponData.discount_value,
      special_price: couponData.special_price,
      target_menu_ids: targetMenuIds ?? [],
    },
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ coupon: data }, { status: 201 });
}

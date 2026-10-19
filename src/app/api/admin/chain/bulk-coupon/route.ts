import { platformControlResponse } from '@/lib/platform-control-write';
/**
 * POST /api/admin/chain/bulk-coupon
 * チェーン全施設に同一クーポンを一括発行
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { UUID_REGEX } from '@/lib/constants';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { validateCouponDiscountFields, normalizeCouponDiscountFields, validateCouponDates } from '@/lib/coupon-validation';
import { serverError, authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';
import { databaseDiagnostic } from '@/lib/database-diagnostic';

const VALID_DISCOUNT_TYPES = ['fixed', 'percentage', 'special_price'] as const;

// 【2026年7月29日・SSOT統一】単体発行(admin/coupons/route.ts)・更新([id]/route.ts)と同一の
// discount_type×discount_value/special_price 相互必須ルールを共有する。従来の手動チェックは
// discount_type の型チェックのみで、fixed/percentage で discount_value 未指定（null）や
// special_price で special_price 未指定のまま作成できていた。coupon-pricing.ts の
// applyDiscountToSubtotal は該当値が falsy の場合フェイルセーフに「割引を適用せず定価を返す」
// 設計のため過大値引きにはならないが、一括発行したクーポンが店舗数分まとめて無割引で
// 機能しなくなる不具合の発生源だった。値の相互必須チェック自体を単体発行と同じ関数に揃える。
const bulkCouponDiscountSchema = z.object({
  discount_type: z.enum(VALID_DISCOUNT_TYPES),
  discount_value: z.number().int().min(0).max(100000).optional().nullable(),
  special_price: z.number().int().min(0).max(9999999).optional().nullable(),
}).superRefine(validateCouponDiscountFields).transform(normalizeCouponDiscountFields);

async function handlePOST(req: NextRequest) {
  try {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 10, 60_000, 'bulk-coupon')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('admin-chain-bulk-coupon-auth', '/api/admin/chain/bulk-coupon');
  const user = verification.state === 'verified' ? verification.user : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { name, coupon_type, discount_type, discount_value, special_price, valid_from, valid_until, facility_ids } = body;

  if (!name || !discount_type || !facility_ids?.length) {
    return NextResponse.json({ error: 'name, discount_type, facility_ids are required' }, { status: 400 });
  }
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
    return NextResponse.json({ error: 'name must be 1-100 characters' }, { status: 400 });
  }
  if (!Array.isArray(facility_ids) || facility_ids.length > 50) {
    return NextResponse.json({ error: 'facility_ids must be array of at most 50' }, { status: 400 });
  }
  if (!facility_ids.every((id: unknown) => typeof id === 'string' && UUID_REGEX.test(id))) {
    return NextResponse.json({ error: 'Invalid facility_ids' }, { status: 400 });
  }
  const targets=facility_ids.map((id:string)=>id.toLowerCase());
  if(new Set(targets).size!==targets.length)return NextResponse.json({error:'Duplicate facility IDs'},{status:400});
  const dates=z.object({valid_from:z.string().nullish(),valid_until:z.string().nullish()}).superRefine(validateCouponDates).safeParse({valid_from,valid_until});
  if(!dates.success)return NextResponse.json({error:'Invalid coupon dates'},{status:400});
  // 【正準値・相互必須】単体発行(admin/coupons)と同一の zod スキーマ(SSOT)で検証する。
  // discount_type の正準値チェック（DB CHECK 制約と一致）に加え、discount_type ごとの
  // discount_value/special_price 必須チェック・型に対応しない側の列の null 正規化まで行う。
  const discountParsed = bulkCouponDiscountSchema.safeParse({ discount_type, discount_value, special_price });
  if (!discountParsed.success) {
    // safeParse が success:false を返す時点で issues は必ず1件以上存在する（zod の仕様）。
    // 到達しない ?? フォールバックは書かない（到達不能コードはブランチカバレッジで検知され、
    // それを埋めるためだけの無意味なテストを誘発するため）。
    return NextResponse.json(
      { error: discountParsed.error.issues[0].message },
      { status: 400 },
    );
  }
  const normDiscountType = discountParsed.data.discount_type;
  const normDiscountValue = discountParsed.data.discount_value;
  const normSpecialPrice = discountParsed.data.special_price;

  const fields={name:name.trim(),coupon_type:['all','new_customer','repeat','limited_time'].includes(coupon_type)?coupon_type:'all',discount_type:normDiscountType,discount_value:normDiscountValue,special_price:normSpecialPrice,valid_from:dates.data.valid_from || null,valid_until:dates.data.valid_until || null,is_active:true};
  const {data,error}=await createServiceRoleClient().rpc('create_chain_coupons_atomic',{p_actor_id:user.id,p_facility_ids:targets,p_values:fields});
  if(error?.code==='42501')return NextResponse.json({error:'Forbidden: some facilities not authorized'},{status:403});
  if(error?.code==='22023')return NextResponse.json({error:'Invalid coupon fields'},{status:400});
  if(error)return serverError('admin-chain-bulk-coupon',databaseDiagnostic(error),'/api/admin/chain/bulk-coupon');
  if(!Array.isArray(data)||data.length!==targets.length||new Set(data.map(row=>row.id)).size!==targets.length||!data.every(row=>UUID_REGEX.test(row.id)&&targets.includes(row.facility_id))||new Set(data.map(row=>row.facility_id)).size!==targets.length)return serverError('admin-chain-bulk-coupon-receipt',new Error('CHAIN_COUPON_UNCONFIRMED'),'/api/admin/chain/bulk-coupon');

  const { ip: auditIp, ua } = getRequestContext(req);
  void writeAuditLog({
    userId: user.id,
    action: 'create',
    tableName: 'coupons',
    newValues: { name: name.trim(), discount_type, facility_ids, count: data.length },
    ipAddress: auditIp,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true, created: data.length }, { status: 201 });
  } catch (error) {
    const response = serverError('admin-chain-bulk-coupon-dependency', databaseDiagnostic(error), '/api/admin/chain/bulk-coupon');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

export async function POST(req:NextRequest){return platformControlResponse(()=>handlePOST(req),'/api/admin/chain/bulk-coupon');}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { validateCouponDiscountFields, normalizeCouponDiscountFields } from '@/lib/coupon-validation';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';

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
}).superRefine(validateCouponDiscountFields).transform(normalizeCouponDiscountFields);

async function getAdminInfo(request: NextRequest): Promise<{ userId: string; facilityId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;

  const { data } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();

  return data ? { userId: user.id, facilityId: data.facility_id } : null;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'coupons-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('coupons')
    .select('*')
    .eq('facility_id', auth.facilityId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ coupons: data });
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'coupons-create')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = couponSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  // target_menu_ids は coupons テーブルの列ではない（coupon_menus へ別途保存）ため insert 前に分離する。
  const { target_menu_ids: targetMenuIds, ...couponData } = parsed.data;

  const admin = createServiceRoleClient();

  // 対象メニューは必ず自施設の facility_menus に実在するものに限定する（他施設メニューIDの
  // 注入を 400 で拒否。coupon_menus は金銭経路＝割引の適用範囲を決めるため fail-closed）。
  if (targetMenuIds && targetMenuIds.length > 0) {
    const { data: menuRows, error: menuErr } = await admin
      .from('facility_menus')
      .select('id')
      .in('id', targetMenuIds)
      .eq('facility_id', auth.facilityId);
    if (menuErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    const validIds = new Set((menuRows ?? []).map((r: { id: string }) => r.id));
    if (!targetMenuIds.every((id) => validIds.has(id))) {
      return NextResponse.json({ error: '対象メニューが不正です' }, { status: 400 });
    }
  }

  const { data, error } = await admin.from('coupons').insert({
    facility_id: auth.facilityId,
    ...couponData,
    is_active: couponData.is_active ?? true,
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  // 対象メニュー限定（coupon_menus）の保存。失敗した場合、クーポンだけが残ると「対象メニュー
  // 限定なし＝全メニュー適用」の意味になってしまう（例：1メニュー限定の特別価格が全メニューに
  // 効く金銭事故）。fail-closed としてクーポン自体をロールバック削除して 500 を返す。
  if (targetMenuIds && targetMenuIds.length > 0) {
    const { error: cmError } = await admin
      .from('coupon_menus')
      .insert(targetMenuIds.map((menuId) => ({ coupon_id: data.id, menu_id: menuId })));
    if (cmError) {
      const { error: rollbackErr } = await admin.from('coupons').delete().eq('id', data.id);
      if (rollbackErr) {
        // ロールバック削除も失敗＝限定なしクーポンが残存する最悪ケース。無効化で金銭事故を防ぐ。
        const { error: deactivateErr } = await admin.from('coupons').update({ is_active: false }).eq('id', data.id);
        if (deactivateErr) {
          // 三重失敗（coupon_menus insert 失敗→ロールバック削除失敗→無効化失敗）＝
          // 「対象メニュー限定なし（全メニュー適用）のまま is_active=true」のクーポンが残存する
          // 金銭事故状態。無音にせず Sentry＋Slack で顕在化し、レスポンスにも明示する
          // （旧実装は無効化の成否未チェックで、三重失敗時に防いだはずの事故が無音再現していた）。
          const tripleFailure = new Error(
            `coupon create rollback triple-failure: coupon_id=${data.id} が全メニュー適用のまま有効で残存の可能性 ` +
            `(insert: ${cmError.message} / delete: ${rollbackErr.message} / deactivate: ${deactivateErr.message})`
          );
          safeCaptureException(tripleFailure, 'admin-coupons-create-rollback');
          alertCaughtError('admin-coupons-create-rollback', tripleFailure, '/api/admin/coupons');
          return NextResponse.json({
            error: '対象メニューの保存に失敗し、クーポンを無効化できませんでした。作成されたクーポンが全メニュー適用のまま有効になっている可能性があります。至急クーポン一覧を確認し、該当クーポンを無効化してください。',
          }, { status: 500 });
        }
      }
      return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    }
  }

  const { ua } = getRequestContext(request);
  void writeAuditLog({
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

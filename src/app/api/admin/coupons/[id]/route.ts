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
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';

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
  if (await checkRateLimit(null, ip, 20, 60_000, 'coupons-patch')) {
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

  // target_menu_ids は coupons テーブルの列ではない（coupon_menus へ delete→insert で同期）ため
  // coupons UPDATE の payload から分離する。
  const { target_menu_ids: targetMenuIds, ...couponFields } = parsed.data;

  const admin = createServiceRoleClient();

  // 対象メニューは必ず自施設の facility_menus に実在するものに限定する（他施設メニューIDの
  // 注入を 400 で拒否。coupon_menus は金銭経路＝割引の適用範囲を決めるため fail-closed）。
  if (targetMenuIds && targetMenuIds.length > 0) {
    const { data: menuRows, error: menuErr } = await admin
      .from('facility_menus')
      .select('id')
      .in('id', targetMenuIds)
      .eq('facility_id', facilityId);
    if (menuErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    const validIds = new Set((menuRows ?? []).map((r: { id: string }) => r.id));
    if (!targetMenuIds.every((id) => validIds.has(id))) {
      return NextResponse.json({ error: '対象メニューが不正です' }, { status: 400 });
    }
  }

  // Include facility_id in WHERE as defence-in-depth (CAS guard against stale verifyCouponAdmin read)
  // .maybeSingle(): verify と update の間に削除される TOCTOU 等で該当0行になった場合、.single() だと
  // PGRST116 error が先に発火し if(error)→500 になり下の 404 分岐が到達不能になる（PR#465 と同型）。
  // target_menu_ids のみの更新（coupons 列の変更なし）は update({}) が PostgREST エラーになるため、
  // 存在確認の SELECT に切り替える（404/TOCTOU の意味論は update 経路と同一に保つ）。
  let data: Record<string, unknown> | null;
  if (Object.keys(couponFields).length > 0) {
    const { data: updated, error } = await admin.from('coupons').update(couponFields).eq('id', params.id).eq('facility_id', facilityId).select().maybeSingle();
    if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    data = updated;
  } else {
    const { data: existing, error } = await admin.from('coupons').select('*').eq('id', params.id).eq('facility_id', facilityId).maybeSingle();
    if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    data = existing;
  }
  if (!data) return NextResponse.json({ error: 'クーポンが見つかりません' }, { status: 404 });

  // 対象メニュー限定（coupon_menus）の同期。undefined＝今回のリクエストでは触らない。
  // 空配列＝限定解除（全行 delete のみ＝全メニュー適用へ）。非空＝delete→insert で置換。
  if (targetMenuIds !== undefined) {
    const { error: delErr } = await admin.from('coupon_menus').delete().eq('coupon_id', params.id);
    if (delErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    if (targetMenuIds.length > 0) {
      const { error: insErr } = await admin
        .from('coupon_menus')
        .insert(targetMenuIds.map((menuId) => ({ coupon_id: params.id, menu_id: menuId })));
      if (insErr) {
        // delete 済み・insert 失敗＝対象メニュー限定が消えて「全メニュー適用」になった状態で
        // 残ると金銭事故（例：1メニュー限定の特別価格が全メニューに効く）。fail-closed として
        // クーポンを無効化してから 500 を返す（管理者が保存し直せば復旧する）。
        const { error: deactivateErr } = await admin.from('coupons').update({ is_active: false }).eq('id', params.id);
        if (deactivateErr) {
          // 二重失敗（insert 失敗→無効化失敗）＝「対象メニュー限定が消えて全メニュー適用のまま
          // is_active=true」のクーポンが残存する金銭事故状態。無音にせず Sentry＋Slack で顕在化し、
          // レスポンスにも明示する（旧実装は無効化の成否未チェックで、二重失敗時に防いだはずの
          // 事故が無音再現していた）。
          const doubleFailure = new Error(
            `coupon update sync double-failure: coupon_id=${params.id} が全メニュー適用のまま有効で残存の可能性 ` +
            `(insert: ${insErr.message} / deactivate: ${deactivateErr.message})`
          );
          safeCaptureException(doubleFailure, 'admin-coupons-update-sync');
          alertCaughtError('admin-coupons-update-sync', doubleFailure, '/api/admin/coupons/[id]');
          return NextResponse.json({
            error: '対象メニューの保存に失敗し、クーポンを無効化できませんでした。このクーポンが全メニュー適用のまま有効になっている可能性があります。至急このクーポンの状態を確認し、対象メニューを設定し直すか無効化してください。',
          }, { status: 500 });
        }
        return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
      }
    }
  }

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await verifyCouponAdmin(params.id, user.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  // 利用実績(coupon_redemptions)がある場合は削除しない。ON DELETE CASCADEにより
  // 監査記録である利用実績が道連れで消えるため、packages/subscription-plansと同様に
  // 無効化のみに留める。
  const { count, error: countErr } = await admin
    .from('coupon_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('coupon_id', params.id);
  if (countErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (count && count > 0) {
    // 更新件数(affected rows)を検証せず常に成功を返し、監査ログも無条件で書いていたため、
    // TOCTOU（利用実績カウント確認後に既削除等）による0件更新も「無効化しました」と偽装していた
    // （phantom success）。.select() で更新行を受け取り、0件なら404（実際に変更が起きた時のみ
    // 監査ログを書く。ハード削除分岐・catalog/[id]・packages/[id] と同型）。
    const { data: deactivated, error: deactivateErr } = await admin
      .from('coupons')
      .update({ is_active: false })
      .eq('id', params.id)
      .eq('facility_id', facilityId)
      .select();
    if (deactivateErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    if (!deactivated || deactivated.length === 0) return NextResponse.json({ error: 'クーポンが見つかりません' }, { status: 404 });

    void writeAuditLog({
      userId: user.id,
      facilityId,
      action: 'update',
      tableName: 'coupons',
      recordId: params.id,
      newValues: { is_active: false },
      ipAddress: ip,
    });

    return NextResponse.json({ message: '利用実績があるため無効化しました' });
  }

  // Include facility_id in WHERE as defence-in-depth (CAS guard against stale verifyCouponAdmin read)
  // 削除件数(affected rows)を検証せず常に成功を返していたため、TOCTOU（利用実績カウント確認後に
  // 既削除等）による0件削除も「成功」と偽装していた（phantom success）。.select() で削除行を受け取り、
  // 0件なら404を返す（customers/[id]・menus/[id]・catalog/[id] と同型）。
  const { data, error } = await admin.from('coupons').delete().eq('id', params.id).eq('facility_id', facilityId).select();
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: 'クーポンが見つかりません' }, { status: 404 });

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

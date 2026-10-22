/**
 * 退店レジ会計 API（Phase B）
 * POST /api/admin/booking-checkout
 *
 * 退店時に実会計を確定・調整する。会計明細（当日メニュー・物販・割引）を bookings.charges に保存し、
 * total_price = Σ amount を再計算して反映。お預かり(paid_amount)を記録しお釣りを返す。
 * complete=true のときは confirmed/arrived → completed へ CAS で原子遷移し、最終金額で
 * applyCompletionSideEffects（来店記録・来店ポイント）を付与する。
 *
 * 権限: 対象施設の owner/admin のみ。会計の権威的金額は total_price（accounting-export/売上集計が参照）。
 *
 * 予約時にお客様が使った CareLink ポイント（bookings.points_used）は、画面では編集できない
 * 「ポイント利用」の行として出し、保存時はサーバーが明細の最後に付け足す（2026年10月23日）。
 * 以前は初期明細が「ポイント利用後の金額」1 行だけで、当日メニューを打ち直すとポイント分の値引きが
 * 消えた（お客様は全額払ったうえにポイントも戻らない）。画面が知っているポイント（points_used）と
 * 予約のポイントが食い違う古い画面からの会計は 409 で止める。明細の合計がポイント利用額を下回る会計は
 * 400 で止める（合計は 0 円に丸まるが、差額のポイントはお客様に戻らないため）。
 */
import { NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { serverError } from '@/lib/with-route';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { writeAuditLog } from '@/lib/audit-logger';
import { applyCompletionSideEffects } from '@/lib/booking-completion';

export const dynamic = 'force-dynamic';

const CHARGE_TYPES = ['menu', 'retail', 'discount'] as const;
type ChargeType = (typeof CHARGE_TYPES)[number];
type Charge = { type: ChargeType; name: string; amount: number };

const MAX_ITEMS = 50;
const MAX_AMOUNT = 100_000_000; // 1件あたりの絶対値上限（暴走・オーバーフロー防止）
/** サーバーが付け足すポイント利用の明細名（会計画面の固定行と同じ表示名）。 */
const POINTS_LINE_NAME = 'ポイント利用';

/** items 入力を検証して正規化。不正なら null を返す。 */
function parseItems(raw: unknown): Charge[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) return null;
  const items: Charge[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) return null;
    const { type, name, amount } = r as Record<string, unknown>;
    if (typeof type !== 'string' || !CHARGE_TYPES.includes(type as ChargeType)) return null;
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) return null;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || !Number.isInteger(amount)) return null;
    if (Math.abs(amount) > MAX_AMOUNT) return null;
    items.push({ type: type as ChargeType, name: name.trim(), amount });
  }
  return items;
}

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
    if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'admin-checkout')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const { bookingId, items, paid_amount, complete, points_used: declaredPoints } = body;

    if (!bookingId || !uuidRegex.test(bookingId)) {
      return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
    }
    const charges = parseItems(items);
    if (!charges) {
      return NextResponse.json({ error: '会計明細が不正です' }, { status: 400 });
    }
    // お預かり(任意)。指定時は 0 以上の整数のみ。
    let paidAmount: number | null = null;
    if (paid_amount !== undefined && paid_amount !== null) {
      if (typeof paid_amount !== 'number' || !Number.isInteger(paid_amount) || paid_amount < 0 || paid_amount > MAX_AMOUNT) {
        return NextResponse.json({ error: 'お預かり金額が不正です' }, { status: 400 });
      }
      paidAmount = paid_amount;
    }
    const wantComplete = complete === true;

    // Auth
    const authClient = await createServerSupabaseAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();

    // 予約取得（権限スコープ確定のため先に取る）
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, facility_id, user_id, customer_name, email, booking_date, menu_id, staff_id, status, updated_at, points_used')
      .eq('id', bookingId)
      .single();

    const membership = booking
      ? await supabase
          .from('facility_members')
          .select('facility_id, role')
          .eq('user_id', user.id)
          .eq('facility_id', booking.facility_id)
          .in('role', ['owner', 'admin'])
          .maybeSingle()
          .then((r) => r.data)
      : null;

    // 「見つからない」と「他施設」を 404 に統一（ID 列挙防止）
    if (!booking || !membership) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }

    // 会計できるのは confirmed / arrived（受付）のみ。pending/cancelled/no_show/completed は不可。
    if (booking.status !== 'confirmed' && booking.status !== 'arrived') {
      return NextResponse.json({ error: 'この予約は会計できません（確定または受付の予約のみ）' }, { status: 400 });
    }

    // 予約時にお客様が使ったポイント。画面の表示と一致しない（ポイント行を知らない古い画面など）まま
    // 保存すると、ポイント分の値引きが黙って消えるので止める。
    const bookingPoints = booking.points_used ?? 0;
    if ((declaredPoints ?? 0) !== bookingPoints) {
      return NextResponse.json({ error: 'お客様のポイント利用が画面の表示と一致しません。ページを更新してから会計してください。' }, { status: 409 });
    }
    if (bookingPoints > 0 && charges.length >= MAX_ITEMS) {
      return NextResponse.json({ error: '会計明細が多すぎます（ポイント利用の行を含めて50件までです）' }, { status: 400 });
    }
    // 明細の合計がお客様の使ったポイントを下回る会計は確定しない。合計は 0 円に丸まるが、ポイントは
    // キャンセル時にしか戻らないので、差額のポイントが黙って失われる（例: 8,000pt で予約→当日 5,000 円の
    // メニューで会計すると 3,000pt が消える）。差額だけを戻す仕組みは無いので、店舗に明細を見直してもらう。
    const chargesTotal = charges.reduce((sum, c) => sum + c.amount, 0);
    if (bookingPoints > 0 && chargesTotal < bookingPoints) {
      return NextResponse.json({
        error: `お客様が予約時に使ったポイント（¥${bookingPoints.toLocaleString()}）が明細の合計（¥${Math.max(0, chargesTotal).toLocaleString()}）を上回っています。このまま確定すると差額のポイントがお客様に戻らないため、確定できません。明細を確認してください。`,
      }, { status: 400 });
    }
    const savedCharges: Charge[] = bookingPoints > 0
      ? [...charges, { type: 'discount', name: POINTS_LINE_NAME, amount: -bookingPoints }]
      : charges;

    // 合計 = Σ amount（割引・ポイント利用は負）。負にはしない（ポイントのある予約は上で 0 以上が保証済み）。
    const total = Math.max(0, chargesTotal - bookingPoints);
    const nextStatus = wantComplete ? 'completed' : booking.status;

    const { data: updated, error: updateError } = await supabase.rpc('checkout_booking_with_points_atomic', {
      p_actor_id: user.id, p_booking_id: bookingId, p_expected_status: booking.status,
      p_expected_updated_at: booking.updated_at, p_charges: savedCharges, p_paid_amount: paidAmount, p_complete: wantComplete,
    });
    if (updateError?.message.includes('BOOKING_PERMISSION_DENIED')) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    if (updateError?.message.includes('BOOKING_REVISION_CONFLICT')) return NextResponse.json({ error: 'ステータスが既に変更されています。ページを更新してください。' }, { status: 409 });
    if (updateError) return serverError('admin-booking-checkout-update', updateError, '/api/admin/booking-checkout', '会計の保存に失敗しました');
    if (!updated || updated.length !== 1 || updated[0].id !== bookingId || updated[0].total_price !== total) {
      return serverError('admin-booking-checkout-result', new Error('checkout transaction not confirmed'), '/api/admin/booking-checkout');
    }

    // completed へ進入した場合のみ、最終金額で来店記録・来店ポイントを付与する。
    if (wantComplete) {
      await applyCompletionSideEffects(supabase, {
        id: booking.id,
        facility_id: booking.facility_id,
        user_id: booking.user_id,
        customer_name: booking.customer_name,
        email: booking.email,
        booking_date: booking.booking_date,
        total_price: total,
        menu_id: booking.menu_id,
        staff_id: booking.staff_id,
      });
    }

    void writeAuditLog({
      userId: user.id,
      facilityId: booking.facility_id,
      // 完了確定は confirm（/api/booking/complete と同流儀）、明細保存のみは update。
      action: wantComplete ? 'confirm' : 'update',
      tableName: 'bookings',
      recordId: bookingId,
      oldValues: { status: booking.status },
      newValues: { status: nextStatus, total_price: total, item_count: savedCharges.length, points_used: bookingPoints, kind: 'checkout' },
      ipAddress: ip,
      userAgent: request.headers.get('user-agent') ?? null,
    });

    const change = paidAmount !== null ? paidAmount - total : null;
    return NextResponse.json({ success: true, total_price: total, change });
  } catch (e) {
    return serverError('admin-booking-checkout', e, '/api/admin/booking-checkout');
  }
}

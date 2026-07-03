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
 */
import { NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
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
    const { bookingId, items, paid_amount, complete } = body;

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

    // 合計 = Σ amount（割引は負）。負にはしない。
    const total = Math.max(0, charges.reduce((sum, c) => sum + c.amount, 0));

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
      .select('id, facility_id, user_id, customer_name, email, booking_date, menu_id, staff_id, status')
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

    const nextStatus = wantComplete ? 'completed' : booking.status;

    // CAS: 読み取り時の status を WHERE に含め、並行更新による状態機械バイパスを防ぐ。
    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update({
        charges,
        total_price: total,
        ...(paidAmount !== null ? { paid_amount: paidAmount } : {}),
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('facility_id', booking.facility_id)
      .eq('status', booking.status)
      .select('id');

    if (updateError) {
      return NextResponse.json({ error: '会計の保存に失敗しました' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'ステータスが既に変更されています。ページを更新してください。' }, { status: 409 });
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
      newValues: { status: nextStatus, total_price: total, item_count: charges.length, kind: 'checkout' },
      ipAddress: ip,
      userAgent: request.headers.get('user-agent') ?? null,
    });

    const change = paidAmount !== null ? paidAmount - total : null;
    return NextResponse.json({ success: true, total_price: total, change });
  } catch (e) {
    safeCaptureException(e, 'admin-booking-checkout');
    alertCaughtError('admin-booking-checkout', e, '/api/admin/booking-checkout');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

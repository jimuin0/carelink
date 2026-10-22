import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { getBearerToken, resolveLiffUserId } from '@/lib/liff-auth';
import { hoursUntilBookingStart, ONLINE_CANCEL_DISABLED_MESSAGE } from '@/lib/cancel-fee';
import { cancelFeeContextSchema, cancelFeeFromContext } from '@/lib/cancel-fee-receipt';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { serverError, authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { writeAuditLog } from '@/lib/audit-logger';
import { canCustomerCancelBooking } from '@/lib/booking-status';


export const dynamic = 'force-dynamic';

export async function POST(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
  const csrfError = checkCsrf(_request);
  if (csrfError) return csrfError;

  const ip = getClientIp(_request);
  if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'cancel')) {
    return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
  }

  if (!uuidRegex.test(params.id)) {
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
  }
  // 認証は2経路。LIFF（LINE 内ブラウザ）は Supabase セッション Cookie を持たないため、
  // Authorization: Bearer の LINE access token で本人解決し、DB は service role を使う
  // （所有権は下の user_id 明示フィルタ・status CAS で担保しており RLS に依存しない）。
  // それ以外（Web / mypage）は従来どおり Cookie セッション認証＝挙動を一切変えない。
  const bearer = getBearerToken(_request);
  let userId: string;
  let db: SupabaseClient;
  if (bearer) {
    const liffUserId = await resolveLiffUserId(bearer);
    if (!liffUserId) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    userId = liffUserId;
    db = createServiceRoleClient();
  } else {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );
    const verification = await verifyAuthUser(supabase.auth);
    if (verification.state === 'unavailable') return authUnavailable('booking-cancel-auth', '/api/booking/[id]/cancel');
    if (verification.state !== 'verified') {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    userId = verification.user.id;
    db = supabase as unknown as SupabaseClient;
  }

  const { data: booking, error: bookingReadError } = await db
    .from('bookings')
    .select('id, user_id, status, facility_id, customer_name, email, booking_date, start_time, end_time, total_price, menu_id, staff_id, points_used')
    .eq('id', params.id)
    .maybeSingle();

  if (bookingReadError) return serverError('booking-cancel-read', databaseDiagnostic(bookingReadError), '/api/booking/[id]/cancel', '予約を確認できません。時間をおいて再確認してください。');
  if (!booking) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
  if (booking.user_id !== userId) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  // キャンセル済み・キャンセル料支払い済み・完了済みは操作不可
  if (!canCustomerCancelBooking(booking.status)) {
    return NextResponse.json({ error: 'この予約はキャンセルできません' }, { status: 400 });
  }

  // 開始時刻を過ぎた予約はオンラインでキャンセル不可（A-12）。来店済み/無断キャンセルは施設側が
  // completed/no_show で記録すべきで、客が事後に cancelled へ上書きできると no_show 判定や
  // トラブル記録を握り潰せてしまう。キャンセル料算出と同じ JST 基準ヘルパで開始経過を判定する
  // （素の Date 比較による TZ ズレを回避）。当日でも start_time を過ぎた分のみを弾く粒度。
  if (hoursUntilBookingStart(booking.booking_date, booking.start_time, Date.now()) < 0) {
    return NextResponse.json({ error: '予約開始時刻を過ぎているため、オンラインでのキャンセルはできません。施設へ直接ご連絡ください。' }, { status: 400 });
  }

  // 本人・状態・開始時刻をtransaction内で再検証し、返還と取消を一緒に保存する。
  const writeDb = createServiceRoleClient();
  const { data: cancelled, error } = await writeDb.rpc('cancel_customer_booking_with_channels_atomic', {
    p_actor_id: userId, p_booking_id: params.id, p_expected_status: booking.status,
  });
  if (error?.message.includes('BOOKING_PERMISSION_DENIED')) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
  if (error?.message.includes('BOOKING_REVISION_CONFLICT')) return NextResponse.json({ error: 'ステータスが既に変更されています。ページを更新してください。' }, { status: 409 });
  if (error?.message.includes('BOOKING_ALREADY_STARTED')) return NextResponse.json({ error: '予約開始時刻を過ぎているため、オンラインでのキャンセルはできません。施設へ直接ご連絡ください。' }, { status: 400 });
  // 店舗が「ネットでのキャンセル不可（店舗へ直接ご連絡）」を選んでいる（RPC がポリシー行を見て拒否する）。
  if (error?.message.includes('BOOKING_ONLINE_CANCEL_DISABLED')) return NextResponse.json({ error: ONLINE_CANCEL_DISABLED_MESSAGE, code: 'ONLINE_CANCEL_DISABLED' }, { status: 400 });
  if (error) return serverError('booking-cancel-update', databaseDiagnostic(error), '/api/booking/[id]/cancel', 'キャンセルに失敗しました');
  if (!cancelled || cancelled.length !== 1) return NextResponse.json({ error: 'キャンセル結果を確認できません。ページを更新してください。' }, { status: 409 });
  if (cancelled[0].id !== params.id) return serverError('booking-cancel-result', new Error('cancel transaction target not confirmed'), '/api/booking/[id]/cancel');

  const feeContext = cancelFeeContextSchema.safeParse(cancelled[0].fee_context);
  if (!feeContext.success) return serverError('booking-cancel-receipt', new Error('cancel fee context not confirmed'), '/api/booking/[id]/cancel');

  // 監査ログ（非ブロッキング）
  void writeAuditLog({
    userId,
    facilityId: booking.facility_id,
    action: 'cancel',
    tableName: 'bookings',
    recordId: booking.id,
    oldValues: { status: booking.status },
    newValues: { status: 'cancelled' },
    ipAddress: getClientIp(_request),
  });

  // The receipt includes fee inputs captured by the committed transaction
  // (the same inputs as the customer/owner emails and the admin booking detail).
  const cancelFee = cancelFeeFromContext(feeContext.data).fee;

  return NextResponse.json({ success: true, cancelFee });
  } catch (e) {
    return serverError('booking-cancel', e, '/api/booking/[id]/cancel');
  }
}

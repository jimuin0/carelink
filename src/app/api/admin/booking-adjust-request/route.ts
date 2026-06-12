import { NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { safeCaptureException } from '@/lib/safe';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { writeAuditLog } from '@/lib/audit-logger';
import { hasEntitlement, type EntitlementsClient } from '@/lib/entitlements';

/**
 * 予約時間調整のお願いを顧客へ送信（SB の予約詳細から）
 * POST /api/admin/booking-adjust-request  body: { bookingId, channel: 'email' | 'line' }
 *
 * - email: 無料（全施設）
 * - line:  有料オプション time_adjust_line の購入が必要。顧客の LINE 連携も必要。
 */

export const dynamic = 'force-dynamic';

const VALID_CHANNELS = ['email', 'line'] as const;

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
    if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'admin-adjust-request')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const { bookingId, channel } = body as { bookingId?: string; channel?: string };

    if (!bookingId || !uuidRegex.test(bookingId)) {
      return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
    }
    if (!VALID_CHANNELS.includes(channel as (typeof VALID_CHANNELS)[number])) {
      return NextResponse.json({ error: '送信方法が不正です' }, { status: 400 });
    }

    // Auth check（セッション検証には authClient を使用）
    const authClient = await createServerSupabaseAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // DB 操作には serviceRole を使用（RLS バイパス）
    const supabase = createServiceRoleClient();

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, facility_id, user_id, customer_name, email, booking_date, start_time, end_time, status')
      .eq('id', bookingId)
      .single();

    // Permission check: must be owner/admin of this booking's facility
    // Both "not found" and "wrong owner" return 404 to prevent booking ID enumeration
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

    if (!booking || !membership) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }

    // 終了済み・キャンセル済み予約には送らない（誤送信防止）
    if (booking.status !== 'pending' && booking.status !== 'confirmed') {
      return NextResponse.json({ error: 'この予約には時間調整依頼を送れません' }, { status: 400 });
    }

    // 施設名（文面用）
    const { data: facility } = await supabase
      .from('facility_profiles')
      .select('name')
      .eq('id', booking.facility_id)
      .maybeSingle();
    const facilityName = facility?.name ?? '';

    if (channel === 'email') {
      // メール送信は無料
      if (!booking.email) {
        return NextResponse.json({ error: 'この予約にはメールアドレスがありません' }, { status: 400 });
      }
      const { sendTimeAdjustRequest } = await import('@/lib/email');
      await sendTimeAdjustRequest({
        customerName: booking.customer_name,
        customerEmail: booking.email,
        facilityName,
        bookingDate: booking.booking_date,
        startTime: booking.start_time,
        endTime: booking.end_time,
        bookingId: booking.id,
      });
    } else {
      // LINE 送信は有料オプション time_adjust_line が必要。
      // supabase（完全型付き SupabaseClient）を構造的型 EntitlementsClient へ明示キャストし、
      // hasEntitlement 内 2 層の型インスタンス化が深くなる TS2589 を回避する（実体は同一クライアント）。
      const entitled = await hasEntitlement(supabase as unknown as EntitlementsClient, booking.facility_id, 'time_adjust_line');
      if (!entitled) {
        return NextResponse.json({ error: 'LINE送信は有料オプション（時間調整依頼のLINE送信）のご購入が必要です' }, { status: 403 });
      }
      if (!booking.user_id) {
        return NextResponse.json({ error: 'この予約の顧客はLINE連携していません' }, { status: 400 });
      }
      const { data: link } = await supabase
        .from('line_user_links')
        .select('line_user_id')
        .eq('user_id', booking.user_id)
        .maybeSingle();
      if (!link?.line_user_id) {
        return NextResponse.json({ error: 'この予約の顧客はLINE連携していません' }, { status: 400 });
      }
      const { sendLineText } = await import('@/lib/line');
      const text = [
        '🕒 ご予約時間調整のお願い',
        '',
        `📍 ${facilityName}`,
        `📅 ${booking.booking_date} ${booking.start_time}`,
        '',
        '上記ご予約のお時間について調整のお願いがございます。',
        'マイページの予約変更、または施設へのご連絡にてご都合をお知らせください。',
      ].join('\n');
      const ok = await sendLineText(link.line_user_id, text);
      if (!ok) {
        return NextResponse.json({ error: 'LINEの送信に失敗しました。時間をおいて再度お試しください。' }, { status: 502 });
      }
    }

    // 監査ログ（fire-and-forget）
    writeAuditLog({
      userId: user.id,
      facilityId: booking.facility_id,
      action: 'booking_adjust_request',
      tableName: 'bookings',
      recordId: booking.id,
      newValues: { channel },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    safeCaptureException(e, 'booking-adjust-request');
    return NextResponse.json({ error: '送信に失敗しました' }, { status: 500 });
  }
}

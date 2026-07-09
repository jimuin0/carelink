import { NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { checkCsrf } from '@/lib/csrf';
import { sendBookingConfirmed, sendBookingCancelled, sendBookingStatusUpdate } from '@/lib/email';
import { sendBookingCancellation as sendLineCancellation } from '@/lib/line';
import { sendPushToUser } from '@/lib/push';
import { reverseCompletionSideEffects } from '@/lib/booking-completion-reversal';
import { applyCompletionSideEffects } from '@/lib/booking-completion';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { writeAuditLog } from '@/lib/audit-logger';
import { ALLOWED_STATUS_TRANSITIONS } from '@/lib/booking-status';

export const dynamic = 'force-dynamic';

// 手動で設定できる status＝遷移マシン（SSOT）のいずれかの遷移先に現れる値の集合。
// ハードコードせず ALLOWED_STATUS_TRANSITIONS から導出することで、遷移先を追加しても
// この受理リストが自動で追従し、両者のドリフト（pending/cancel_fee_paid のような死にステータス
// 混入や、逆に新ステータスの取りこぼし）を構造的に防ぐ。現状の集合は
// {confirmed, arrived, completed, cancelled, no_show} で従来と完全一致＝挙動不変。
const validStatuses: string[] = [...new Set(Object.values(ALLOWED_STATUS_TRANSITIONS).flat())];

// State machine（遷移可否）は UI と共有する SSOT（src/lib/booking-status.ts の
// ALLOWED_STATUS_TRANSITIONS）を参照する。UI 側（予約詳細のボタン表示）と本検証が
// 同一表を見ることで、UI が API で必ず弾かれる「死にボタン」を出す不整合を防ぐ。
const allowedTransitions: Record<string, string[]> = ALLOWED_STATUS_TRANSITIONS;

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
    if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'admin-status')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const { bookingId, status, reason } = body;

    if (!bookingId || !uuidRegex.test(bookingId)) {
      return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
    }
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: '不正なステータスです' }, { status: 400 });
    }

    // Auth check（セッション検証には authClient を使用）
    const authClient = await createServerSupabaseAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // DB 操作には serviceRole を使用（RLS バイパス、RLS 変更の影響を受けない）
    const supabase = createServiceRoleClient();

    // Fetch booking first to scope the permission check
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, facility_id, user_id, customer_name, email, booking_date, start_time, end_time, total_price, menu_id, staff_id, status, points_used')
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

    if (booking.status === status) {
      return NextResponse.json({ error: '既にそのステータスです' }, { status: 400 });
    }

    // State machine validation: only permit defined transitions
    const permitted = allowedTransitions[booking.status] ?? [];
    if (!permitted.includes(status)) {
      return NextResponse.json(
        { error: `このステータス変更は許可されていません（${booking.status} → ${status}）` },
        { status: 400 }
      );
    }

    // Update status — include current status in WHERE clause (CAS) so concurrent updates
    // cannot bypass the state machine by updating a stale read.
    const { data: updated, error } = await supabase
      .from('bookings')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('facility_id', booking.facility_id)
      .eq('status', booking.status)  // atomic guard: fail if status changed since we read it
      .select('id');

    if (error) {
      return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'ステータスが既に変更されています。ページを更新してください。' }, { status: 409 });
    }

    // completed から離脱（誤完了→no_show 修正等）した場合、完了時に付与した来店記録・ポイントを取り消す。
    // completed からの許可遷移は no_show のみ（completed→completed は上の「既にそのステータス」で弾かれる）
    // ため、origin が completed か否かの単一条件で足りる。
    if (booking.status === 'completed') {
      await reverseCompletionSideEffects(createServiceRoleClient(), bookingId);
    }

    // completed へ「進入」した場合、来店記録(customer_visits)・来店ポイントを付与する。
    // 以前は完了の副作用が未配線の /api/booking/complete にしか無く、実運用(ステータス
    // ドロップダウン)経由の完了では customer_visits が一切積まれず、顧客一覧の来店実績が
    // 常に空・来店ポイント未付与だった（8体監査の追検証で確定した本番無音バグの根治）。
    // CAS 更新成功後＝confirmed→completed が1回だけ確定した後に呼ぶため重複付与しない。
    if (status === 'completed') {
      await applyCompletionSideEffects(supabase, booking);
    }

    // cancelled へ「進入」した場合、予約作成時に控除した利用ポイントを返還する（金銭損失防止）。
    // 顧客側キャンセル(/api/booking/[id]/cancel)と対称。CAS 更新成功後＝1予約あたり1回のみ到達するため
    // 二重返還は起きない。元状態が cancelled の遷移は state machine で存在しない（cancelled は終端）。
    // 失敗は致命でないため warn のみ（要手動照合）。
    if (status === 'cancelled') {
      const refundPoints = booking.points_used ?? 0;
      if (refundPoints > 0 && booking.user_id) {
        const { error: refundErr } = await supabase.from('user_points').insert({
          user_id: booking.user_id,
          points: refundPoints,
          reason: 'キャンセル返還',
          booking_id: booking.id,
        });
        if (refundErr) {
          console.error('[admin-booking-status] point refund failed — manual cleanup needed', { bookingId: booking.id, points: refundPoints, err: refundErr.message });
        }
      }
    }

    void writeAuditLog({
      userId: user.id,
      facilityId: booking.facility_id,
      action: 'update',
      tableName: 'bookings',
      recordId: bookingId,
      oldValues: { status: booking.status },
      newValues: { status, reason: reason ?? null },
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent') ?? null,
    });

    // Fetch facility name and menu/staff names for email
    const { data: facility } = await supabase
      .from('facility_profiles')
      .select('name')
      .eq('id', membership.facility_id)
      .single();

    let menuName: string | undefined;
    let staffName: string | undefined;

    if (booking.menu_id) {
      const { data: menu } = await supabase.from('facility_menus').select('name').eq('id', booking.menu_id).single();
      menuName = menu?.name;
    }
    if (booking.staff_id) {
      const { data: staff } = await supabase.from('staff_profiles').select('name').eq('id', booking.staff_id).single();
      staffName = staff?.name;
    }

    const emailData = {
      customerName: booking.customer_name,
      customerEmail: booking.email,
      facilityName: facility?.name || '',
      bookingDate: booking.booking_date,
      startTime: booking.start_time,
      endTime: booking.end_time,
      menuName,
      staffName,
      totalPrice: booking.total_price ?? undefined,
      bookingId: booking.id,
    };

    // arrived（受付＝来店中）は来店した客への内部操作のため、顧客への通知は送らない。
    // それ以外のステータス変更は従来どおりメール＋Push で顧客へ通知する。
    // Send appropriate email
    if (status !== 'arrived') {
      try {
        // 各 send 関数は送信失敗時も throw せず false を返す契約のため、戻り値を確認しないと
        // 失敗が無音化する（catch は想定外の例外のみ捕捉する）。
        const sent = status === 'confirmed'
          ? await sendBookingConfirmed(emailData)
          : status === 'cancelled'
            ? await sendBookingCancelled(emailData)
            : await sendBookingStatusUpdate({ ...emailData, newStatus: status, reason });
        if (!sent) {
          const err = new Error(`booking status update email send failed (status=${status})`);
          safeCaptureException(err, 'booking-email');
          alertCaughtError('booking-email', err, '/api/admin/booking-status');
        }
      } catch (e) {
        safeCaptureException(e, 'booking-email');
        alertCaughtError('booking-email', e, '/api/admin/booking-status');
      }
    }

    // cancelled への変更時、顧客の LINE へキャンセル通知（顧客側 /api/booking/[id]/cancel と対称）。
    // 旧実装はメール＋Push のみで顧客 LINE 通知が欠落しており、LINE 連携済み顧客は管理者による
    // キャンセルを LINE で受け取れない非対称があった。sendLineCancellation は throw せず false を
    // 返す契約のため、戻り値を確認して未送達をログに残す（可観測性の確保・非ブロッキング）。
    if (status === 'cancelled' && booking.user_id && process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
      try {
        const { data: lineLink } = await supabase
          .from('line_user_links')
          .select('line_user_id')
          .eq('user_id', booking.user_id)
          .maybeSingle();
        if (lineLink?.line_user_id) {
          const lineOk = await sendLineCancellation(lineLink.line_user_id, {
            facilityName: facility?.name || '',
            menuName: menuName || '',
            date: booking.booking_date,
            time: booking.start_time,
          });
          if (!lineOk) {
            const err = new Error('LINE cancellation notification not delivered');
            console.error('[admin-booking-status] LINE cancellation notification not delivered', { userId: booking.user_id, bookingId: booking.id });
            safeCaptureException(err, 'admin-booking-status-line');
            alertCaughtError('admin-booking-status-line', err, '/api/admin/booking-status');
          }
        }
      } catch (e) {
        console.error('[admin-booking-status] LINE cancellation notification failed', { bookingId: booking.id, err: e });
        safeCaptureException(e, 'admin-booking-status-line');
        alertCaughtError('admin-booking-status-line', e, '/api/admin/booking-status');
      }
    }

    // Push notification to booking user
    if (booking.user_id && status !== 'arrived') {
      const statusLabels: Record<string, string> = {
        confirmed: '予約が確定しました',
        cancelled: '予約がキャンセルされました',
        completed: '施術が完了しました',
        no_show: '来店確認が取れませんでした',
      };
      // 【2026年7月7日 本番実データで確定した恒久根治】waitUntil() の fire-and-forget は Fluid Compute
      // 無効の本番でレスポンス返却直後に凍結され後処理が全滅していた（/api/review と同一の欠陥・同一の
      // 根治）。レスポンス前に await して確実に送る。末尾 .catch で握るため本体レスポンスには影響しない。
      await sendPushToUser(booking.user_id, {
        title: statusLabels[status] || /* istanbul ignore next */ 'ステータス更新',
        body: `${facility?.name || ''} ${booking.booking_date} ${booking.start_time}〜`,
        url: `/mypage/bookings/${booking.id}`,
        tag: `booking-status-${booking.id}`,
      }).catch((e) => safeCaptureException(e, 'admin-booking-status-push'));
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    safeCaptureException(e, 'admin-booking-status');
    // safeCaptureException は console.error のみで Slack 通知しないため、500 経路では別途明示通知する
    // （catch して 500 を返すと onRequestError に伝播せず Slack 通知が漏れる）。cancel/route.ts と対称。
    alertCaughtError('admin-booking-status', e, '/api/admin/booking-status');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

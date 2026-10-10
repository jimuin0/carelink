import { NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { authUnavailable, serverError } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';
import { checkCsrf } from '@/lib/csrf';
import { buildStatusEnvelope } from '@/lib/booking-status-envelope';
import { sendBookingCancellation as sendLineCancellation } from '@/lib/line';
import { resolveLineUserIdForUser } from '@/lib/line-link';
import { sendPushToUser } from '@/lib/push';
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
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
    const { bookingId, status, reason } = body;
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000)) return NextResponse.json({ error: '理由は1000文字以内で入力してください' }, { status: 400 });

    if (!bookingId || !uuidRegex.test(bookingId)) {
      return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
    }
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: '不正なステータスです' }, { status: 400 });
    }

    // Auth check（セッション検証には authClient を使用）
    const authClient = await createServerSupabaseAuthClient();
    const verification = await verifyAuthUser(authClient.auth);
    if (verification.state === 'unavailable') return authUnavailable('admin-booking-status', '/api/admin/booking-status');
    if (verification.state === 'unauthenticated') {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    const user = verification.user;

    // DB 操作には serviceRole を使用（RLS バイパス、RLS 変更の影響を受けない）
    const supabase = createServiceRoleClient();

    // Fetch booking first to scope the permission check
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, facility_id, user_id, customer_name, email, booking_date, start_time, end_time, total_price, menu_id, menu_ids, staff_id, status, points_used, updated_at')
      .eq('id', bookingId)
      .single();
    if (bookingError && bookingError.code !== 'PGRST116') return serverError('admin-booking-status-read', bookingError, '/api/admin/booking-status');

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
          .then((r) => { if (r.error) throw new Error('booking permission observation failed'); return r.data; })
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

    // Current membership, booking revision, state transition and immutable
    // email outbox are committed together. A process crash after this RPC
    // cannot leave a saved status without its email reservation.
    const envelope = await buildStatusEnvelope(supabase, booking, status, reason);
    const { data: updated, error } = await supabase
      .rpc('save_booking_email_event_atomic', { p_actor_id: user.id, p_booking_id: bookingId,
        p_expected_status: booking.status, p_expected_updated_at: booking.updated_at,
        p_new_status: status, p_envelope: envelope });

    if (error?.message.includes('BOOKING_PERMISSION_DENIED')) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    if (error?.message.includes('BOOKING_REVISION_CONFLICT')) return NextResponse.json({ error: 'ステータスが既に変更されています。ページを更新してください。' }, { status: 409 });
    if (error) {
      return serverError('admin-booking-status-update', error, '/api/admin/booking-status', '更新に失敗しました');
    }
    if (updated?.length !== 1 || !['queued','not_requested'].includes(updated[0].notification)
      || (updated[0].notification === 'queued' ? !updated[0].operation_id || !uuidRegex.test(updated[0].operation_id)
        : updated[0].operation_id !== null)) {
      return serverError('admin-booking-status-result', new Error('status transaction not confirmed'), '/api/admin/booking-status', '変更結果を確認できません。ページを更新してください。');
    }

    // 来店・取消ポイントも上のtransaction内で保存済み。紹介処理だけを追加で実行する。
    if (status === 'completed') await applyCompletionSideEffects(supabase, booking);

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

    // Remaining names are for the optional LINE path. Email is frozen above.
    const { data: facility } = await supabase
      .from('facility_profiles')
      .select('name')
      .eq('id', membership.facility_id)
      .single();

    let menuName: string | undefined;

    if (booking.menu_id) {
      const { data: menu } = await supabase.from('facility_menus').select('name').eq('id', booking.menu_id).single();
      menuName = menu?.name;
    }

    // Email was already reserved by the atomic RPC, never send it again here.

    // cancelled への変更時、顧客の LINE へキャンセル通知（顧客側 /api/booking/[id]/cancel と対称）。
    // 旧実装はメール＋Push のみで顧客 LINE 通知が欠落しており、LINE 連携済み顧客は管理者による
    // キャンセルを LINE で受け取れない非対称があった。sendLineCancellation は throw せず false を
    // 返す契約のため、戻り値を確認して未送達をログに残す（可観測性の確保・非ブロッキング）。
    if (status === 'cancelled' && booking.user_id && process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
      try {
        // 【監査C2】連携の単一ソース profiles.line_user_id で解決（line_user_links.user_id は常にNULL）。
        const customerLineUserId = await resolveLineUserIdForUser(supabase, booking.user_id);
        if (customerLineUserId) {
          const lineOk = await sendLineCancellation(customerLineUserId, {
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
    return serverError('admin-booking-status', e, '/api/admin/booking-status');
  }
}

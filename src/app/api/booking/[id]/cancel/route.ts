import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { getBearerToken, resolveLiffUserId } from '@/lib/liff-auth';
import { sendPushToFacilityOwners } from '@/lib/push';
import { getFacilityNotificationSettings } from '@/lib/notification-settings';
import { computeCancelFee, hoursUntilBookingStart, type CancelPolicy } from '@/lib/cancel-fee';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { sendBookingCancelled, sendBookingCancellationToFacility } from '@/lib/email';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { sendBookingCancellation as sendLineCancellation } from '@/lib/line';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { writeAuditLog } from '@/lib/audit-logger';
import { notifyCancellationLineWorks, isLineWorksConfigured } from '@/lib/integrations/line-works';
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    userId = user.id;
    db = supabase as unknown as SupabaseClient;
  }

  const { data: booking } = await db
    .from('bookings')
    .select('id, user_id, status, facility_id, customer_name, email, booking_date, start_time, end_time, total_price, menu_id, staff_id, points_used')
    .eq('id', params.id)
    .single();

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

  // CAS: 読み取った status を WHERE に含める（単一文の条件付き UPDATE＝原子的）。読み取り〜更新の間に
  // 別経路（stripe webhook の cancel_fee_paid / admin の completed 等）が状態を変えていたら 0 行と
  // なり 409 を返す。旧実装は status 条件も 0 行検査もなく、completed/cancel_fee_paid を cancelled で
  // 握り潰す競合が成立し得た（8体監査 A4#5）。
  // DB-1: cookie(Web/mypage)分岐では db は anon クライアントで、この UPDATE は撤去した
  // bookings_owner_update ポリシー+anon の直接 UPDATE 権に依存していた。所有権は上の
  // booking.user_id !== userId ガードでサーバ側検証済みのため、UPDATE は service_role で実行する。
  // CAS 条件(.eq('user_id', userId)/.eq('status', ...))はそのまま維持し、原子性・本人限定・競合検知
  // (0行→409)を保つ。LIFF 分岐は既に db=service_role だが、両分岐とも service_role 書込に統一する。
  const writeDb = createServiceRoleClient();
  const { data: cancelled, error } = await writeDb
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', userId)
    .eq('status', booking.status)
    .select('id');

  if (error) {
    return NextResponse.json({ error: 'キャンセルに失敗しました' }, { status: 500 });
  }
  if (!cancelled || cancelled.length === 0) {
    return NextResponse.json({ error: 'ステータスが既に変更されています。ページを更新してください。' }, { status: 409 });
  }

  // ポイント返還（金銭損失防止）。予約作成時に points_used を控除済みのため、キャンセル成立時に
  // 同額を補償行として戻す。CAS により本パスは1予約あたり1回しか到達しない（status 条件付き UPDATE が
  // 成功した時のみ）ため、二重返還は起きない。失敗は致命でないため warn のみ（要手動照合）。
  // user_points は authenticated に INSERT ポリシーが無いため service_role で挿入する。
  // booking.user_id は上の所有権チェック（!== userId で 403）により userId と一致＝非 null 保証。
  const refundPoints = booking.points_used ?? 0;
  if (refundPoints > 0) {
    const refundClient = createServiceRoleClient();
    const { error: refundErr } = await refundClient.from('user_points').insert({
      user_id: userId,
      points: refundPoints,
      reason: 'キャンセル返還',
      booking_id: booking.id,
    });
    if (refundErr) {
      console.error('[cancel] point refund failed — manual cleanup needed', { bookingId: booking.id, points: refundPoints, err: refundErr.message });
    }
  }

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

  // キャンセル料（無料期限超過時のみ正の値・客への通知用。実徴収は店舗と客が直接やり取りする方針）。
  // facility_cancel_policies の料率と予約開始までの残時間から算出する。取得失敗してもキャンセルは成立。
  let cancelFee = 0;
  try {
    const { data: policy } = await db
      .from('facility_cancel_policies')
      .select('free_cancel_hours, late_cancel_rate, no_show_rate')
      .eq('facility_id', booking.facility_id)
      .maybeSingle();
    const hours = hoursUntilBookingStart(booking.booking_date, booking.start_time, Date.now());
    cancelFee = computeCancelFee(policy as CancelPolicy | null, booking.total_price, hours).fee;
  } catch (e) {
    safeCaptureException(e, 'cancel-fee-calc');
  }

  // レスポンス返却後に走らせていた副作用（メール・LINE・Push 通知）をここに集約し、return 直前に
  // await Promise.allSettled でまとめて完了させる。【2026年7月7日 本番実データで確定した恒久根治】
  // waitUntil() の fire-and-forget は Fluid Compute 無効の本番でレスポンス返却直後に凍結され後処理が
  // 全滅していた（口コミルート /api/review と同一の欠陥・同一の根治）。allSettled なので個別 send の
  // 失敗（reject 含む）は本体レスポンス(200)に影響しない。
  const cancelSideEffects: Promise<unknown>[] = [];

  // Send cancellation email (non-blocking)
  try {
    const { data: facility } = await db.from('facility_profiles').select('name').eq('id', booking.facility_id).single();
    let menuName: string | undefined;
    if (booking.menu_id) {
      const { data: menu } = await db.from('facility_menus').select('name').eq('id', booking.menu_id).single();
      menuName = menu?.name;
    }
    const emailData = {
      customerName: booking.customer_name,
      customerEmail: booking.email,
      facilityName: facility?.name || '',
      bookingDate: booking.booking_date,
      startTime: booking.start_time,
      endTime: booking.end_time,
      menuName,
      totalPrice: booking.total_price ?? undefined,
      bookingId: booking.id,
      cancelFee,
    };
    // sendBookingCancelled/sendBookingCancellationToFacility は送信失敗時も throw せず false を
    // 返す契約のため、void で捨てると失敗が無音化する。戻り値を確認して可視化する。
    cancelSideEffects.push(
      sendBookingCancelled(emailData).then((ok) => {
        if (!ok) {
          const err = new Error('booking cancellation email send failed');
          safeCaptureException(err, 'cancel-email');
          alertCaughtError('cancel-email', err, '/api/booking/[id]/cancel');
        }
      })
    );

    // サロンオーナーにキャンセル通知
    const { data: owner } = await db
      .from('facility_members')
      .select('user_id')
      .eq('facility_id', booking.facility_id)
      .eq('role', 'owner')
      .limit(1)
      .single();
    if (owner) {
      const { data: ownerProfile } = await db.from('profiles').select('email').eq('id', owner.user_id).single();
      if (ownerProfile?.email) {
        // 店向けは顧客向けテンプレートの流用ではなく、施設向け文面（顧客名・メールを明記し
        // 管理画面へ誘導）で送る。customerEmail は顧客のまま保持し facilityEmail に宛先を渡す。
        cancelSideEffects.push(
          sendBookingCancellationToFacility({ ...emailData, facilityEmail: ownerProfile.email }).then((ok) => {
            if (!ok) {
              const err = new Error('booking cancellation facility email send failed');
              safeCaptureException(err, 'cancel-email-owner');
              alertCaughtError('cancel-email-owner', err, '/api/booking/[id]/cancel');
            }
          })
        );
      }
    }
  } catch (err) {
    console.error('[cancel] email notification failed:', err);
    safeCaptureException(err, 'cancel-email-setup');
    alertCaughtError('cancel-email-setup', err, '/api/booking/[id]/cancel');
  }

  // LINE cancellation notification (non-blocking)
  try {
    if (process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
      const adminSupabase = createServiceRoleClient();
      const { data: lineLink } = await adminSupabase
        .from('line_user_links')
        .select('line_user_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (lineLink?.line_user_id) {
        const { data: facilityForLine } = await db
          .from('facility_profiles')
          .select('name')
          .eq('id', booking.facility_id)
          .maybeSingle();

        let cancelMenuName = '';
        if (booking.menu_id) {
          const { data: menuForLine } = await db.from('facility_menus').select('name').eq('id', booking.menu_id).maybeSingle();
          cancelMenuName = menuForLine?.name || '';
        }

        // sendLineCancellation は失敗時 throw せず false を返す契約。void で捨てると送達失敗が
        // 完全に無音化するため、戻り値を確認して未送達をログに残す（可観測性の確保）。
        const lineOk = await sendLineCancellation(lineLink.line_user_id, {
          facilityName: facilityForLine?.name || '',
          menuName: cancelMenuName,
          date: booking.booking_date,
          time: booking.start_time,
        });
        if (!lineOk) {
          const err = new Error('LINE cancellation notification not delivered');
          console.error('[cancel] LINE cancellation notification not delivered', { userId, bookingId: booking.id });
          safeCaptureException(err, 'cancel-line');
          alertCaughtError('cancel-line', err, '/api/booking/[id]/cancel');
        }
      }
    }
  } catch (err) {
    console.error('[cancel] LINE notification failed:', err);
    safeCaptureException(err, 'cancel-line-setup');
    alertCaughtError('cancel-line-setup', err, '/api/booking/[id]/cancel');
  }

  // LINE Works cancellation notification (non-blocking)
  if (isLineWorksConfigured()) {
    try {
      const adminSupabase = createServiceRoleClient();
      const { data: staffList } = await adminSupabase
        .from('staff_profiles')
        .select('line_works_channel_id, line_works_notify_all, id')
        .eq('facility_id', booking.facility_id)
        .not('line_works_channel_id', 'is', null);

      if (staffList && staffList.length > 0) {
        let cancelMenuName = '';
        if (booking.menu_id) {
          const { data: menuForLW } = await adminSupabase.from('facility_menus').select('name').eq('id', booking.menu_id).maybeSingle();
          cancelMenuName = menuForLW?.name || '';
        }
        const cancelInfo = {
          customerName: booking.customer_name,
          menuName: cancelMenuName,
          bookingDate: booking.booking_date,
          startTime: booking.start_time,
        };
        for (const staff of staffList) {
          if (!staff.line_works_channel_id) continue;
          const isAssigned = staff.id === booking.staff_id;
          if (isAssigned || staff.line_works_notify_all) {
            cancelSideEffects.push(
              notifyCancellationLineWorks(staff.line_works_channel_id, cancelInfo).catch((e) =>
                safeCaptureException(e, 'cancel-lineworks')
              )
            );
          }
        }
      }
    } catch (e) {
      safeCaptureException(e, 'cancel-lineworks-setup');
    }
  }

  // 施設オーナーへのキャンセル Push（non-blocking）。施設の通知設定 push_on_cancel で制御する。
  // 旧実装はキャンセル時にメール/LINE のみで Push 送信が無く、設定トグルが効かない飾りだった。
  try {
    const notif = await getFacilityNotificationSettings(booking.facility_id);
    if (notif.pushOnCancel) {
      cancelSideEffects.push(
        sendPushToFacilityOwners(booking.facility_id, {
          title: '予約がキャンセルされました',
          body: `${booking.customer_name ?? 'お客様'}様 ${booking.booking_date} ${String(booking.start_time).slice(0, 5)}〜 の予約がキャンセルされました`,
          url: '/admin/bookings',
          tag: `cancel-${booking.id}`,
        }).catch((e) => safeCaptureException(e, 'cancel-push-owner'))
      );
    }
  } catch (e) {
    safeCaptureException(e, 'cancel-push-setup');
  }

  // レスポンス返却前に副作用を確実に完了させる（waitUntil 後処理が本番で全滅していた恒久根治）。
  await Promise.allSettled(cancelSideEffects);

  return NextResponse.json({ success: true, cancelFee });
  } catch (e) {
    safeCaptureException(e, 'booking-cancel');
    // safeCaptureException は console.error のみで Slack 通知しないため、500 経路では別途明示通知する
    // （catch して 500 を返すと onRequestError に伝播せず Slack 通知が漏れる）。
    alertCaughtError('booking-cancel', e, '/api/booking/[id]/cancel');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

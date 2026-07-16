import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { z } from 'zod';
import { sendLineWorksMessage, isLineWorksConfigured } from '@/lib/integrations/line-works';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { writeAuditLog } from '@/lib/audit-logger';
import { sendBookingRescheduled } from '@/lib/email';
import { sendPushToUser, sendPushToFacilityOwners } from '@/lib/push';
import { getFacilityNotificationSettings } from '@/lib/notification-settings';
import { getTodayString, getMaxDateString } from '@/lib/validations-booking';
import { isValidIsoDate } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

// 予約変更の入力検証。作成(bookingSchema)と同等の厳密さに揃える：
// 実在日・過去日/1年超の禁止・時刻の妥当性(00-23:00-59)・start<end。
// 旧実装は形式のみ(99:99 や過去日、start>=end を素通し)で、不正時刻が Postgres TIME に渡り
// 500 化したり過去日移動を許していた（作成 route.ts より弱い検証だった）。
// 時刻は /api/slots(get_available_slots RPC) が TIME 型を "HH:MM:SS" で返すため秒を任意許容する
// （作成側 timeString は HH:MM 固定。ここで HH:MM 固定にすると空き枠送信が全て 400 になり退行する）。
const changeTime = z.string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, '正しい時間形式で入力してください')
  .refine((t) => {
    const [h, m, s] = t.split(':').map(Number);
    return h < 24 && m < 60 && (s === undefined || s < 60);
  }, '有効な時間を入力してください');

const changeSchema = z.object({
  booking_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '正しい日付形式で入力してください')
    .refine((d) => isValidIsoDate(d), '有効な日付を入力してください')
    .refine((d) => d >= getTodayString(), '過去の日付は指定できません')
    .refine((d) => d <= getMaxDateString(), '1年以上先の日付は指定できません'),
  start_time: changeTime,
  end_time: changeTime,
}).refine((v) => v.start_time < v.end_time, {
  message: '終了時刻は開始時刻より後にしてください',
  path: ['end_time'],
});

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
    if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'booking-change')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
    }

    if (!uuidRegex.test(params.id)) {
      return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = changeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
    }

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

    // Fetch existing booking
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, user_id, status, facility_id, staff_id')
      .eq('id', params.id)
      .single();

    if (!booking) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    if (booking.user_id !== user.id) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return NextResponse.json({ error: 'この予約は変更できません' }, { status: 400 });
    }

    // 競合チェック＋UPDATE を change_booking_atomic で同一トランザクション・同一 advisory lock
    // 下に実行（TOCTOU 解消）。指名なし(staff_id NULL)もアクティブ施術者数までの容量判定を行う
    // （旧実装は指名なしの競合チェックを完全スキップしていた）。所有権・状態も RPC 内で再検査。
    // DB-2: change_booking_atomic は所有権を p_user_id パラメータのみで判定するため、直接 PostgREST
    // で呼ぶと booking_id と被害者 user_id を渡すだけで他人の予約をリスケできる IDOR だった。RPC は
    // service_role で呼び、migration 側で anon/authenticated の EXECUTE を撤回して直接呼び出しを塞ぐ。
    // 所有権(booking.user_id === user.id)・状態は上の同期ブロックでサーバ側検証済み。
    const rpcClient = createServiceRoleClient();
    const { error } = await rpcClient.rpc('change_booking_atomic', {
      p_booking_id: params.id,
      p_user_id: user.id,
      p_booking_date: parsed.data.booking_date,
      p_start_time: parsed.data.start_time,
      p_end_time: parsed.data.end_time,
    });

    if (error) {
      const msg = error.message || '';
      if (msg.includes('BOOKING_CONFLICT')) {
        return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
      }
      if (msg.includes('BOOKING_NOT_FOUND')) {
        return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
      }
      if (msg.includes('BOOKING_FORBIDDEN')) {
        return NextResponse.json({ error: '権限がありません' }, { status: 403 });
      }
      if (msg.includes('BOOKING_NOT_CHANGEABLE')) {
        return NextResponse.json({ error: 'この予約は変更できません' }, { status: 400 });
      }
      return NextResponse.json({ error: '変更に失敗しました' }, { status: 500 });
    }

    void writeAuditLog({
      userId: user.id,
      facilityId: booking.facility_id,
      action: 'update',
      tableName: 'bookings',
      recordId: params.id,
      newValues: { booking_date: parsed.data.booking_date, start_time: parsed.data.start_time, end_time: parsed.data.end_time },
      ipAddress: ip,
    });

    // レスポンス返却後に走らせていた副作用（メール・Push・LINE Works 通知）をここに集約し、return 直前に
    // await Promise.allSettled でまとめて完了させる。【2026年7月7日 本番実データで確定した恒久根治】
    // waitUntil() の fire-and-forget は Fluid Compute 無効の本番でレスポンス返却直後に凍結され後処理が
    // 全滅していた（口コミルート /api/review と同一の欠陥・同一の根治）。allSettled なので個別 send の
    // 失敗（reject 含む）は本体レスポンス(200)に影響しない。
    const changeSideEffects: Promise<unknown>[] = [];

    // 顧客・オーナーへの変更通知（作成/キャンセルと対称・A-4）。従来はスタッフ向け LINE Works のみで、
    // 顧客への確認(メール/Push)もオーナー Push も欠落していた。変更後の新日時を通知する。非ブロッキング。
    try {
      const notifyDb = createServiceRoleClient();
      const { data: full } = await notifyDb
        .from('bookings')
        .select('customer_name, email, menu_id, total_price')
        .eq('id', params.id)
        .maybeSingle();
      const [{ data: facility }, menuRes] = await Promise.all([
        notifyDb.from('facility_profiles').select('name').eq('id', booking.facility_id).maybeSingle(),
        full?.menu_id
          ? notifyDb.from('facility_menus').select('name').eq('id', full.menu_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (full?.email) {
        // sendBookingRescheduled は送信失敗時も throw せず false を返す契約のため、.catch() だけでは
        // 失敗が無音化する（想定外の例外のみ catch が発火する）。戻り値を確認して可視化する。
        changeSideEffects.push(
          sendBookingRescheduled({
            customerName: full.customer_name ?? '',
            customerEmail: full.email,
            facilityName: facility?.name ?? '',
            bookingDate: parsed.data.booking_date,
            startTime: parsed.data.start_time,
            endTime: parsed.data.end_time,
            menuName: menuRes.data?.name ?? undefined,
            totalPrice: full.total_price ?? undefined,
            bookingId: params.id,
          }).then((ok) => {
            if (!ok) {
              const err = new Error('booking rescheduled email send failed');
              safeCaptureException(err, 'change-email');
              alertCaughtError('change-email', err, '/api/booking/[id]/change');
            }
          }).catch((e) => {
            safeCaptureException(e, 'change-email');
            alertCaughtError('change-email', e, '/api/booking/[id]/change');
          })
        );
      }
      changeSideEffects.push(
        sendPushToUser(user.id, {
          title: 'ご予約日時を変更しました',
          body: `${parsed.data.booking_date} ${parsed.data.start_time}〜に変更しました`,
          url: `/mypage/bookings/${params.id}`,
          tag: `booking-change-${params.id}`,
        }).catch((e) => safeCaptureException(e, 'change-push-user'))
      );
      const notif = await getFacilityNotificationSettings(booking.facility_id);
      if (notif.pushOnNewBooking) {
        changeSideEffects.push(
          sendPushToFacilityOwners(booking.facility_id, {
            title: '予約日時変更',
            body: `${full?.customer_name ?? 'お客様'}が${parsed.data.booking_date} ${parsed.data.start_time}〜に変更しました`,
            url: '/admin/bookings',
            tag: `booking-change-owner-${params.id}`,
          }).catch((e) => safeCaptureException(e, 'change-push-owner'))
        );
      }
    } catch (e) {
      safeCaptureException(e, 'change-notify-setup');
    }

    // LINE Works change notification (non-blocking)
    if (isLineWorksConfigured()) {
      try {
        const adminSupabase = createServiceRoleClient();
        const { data: staffList } = await adminSupabase
          .from('staff_profiles')
          .select('line_works_channel_id, line_works_notify_all, id')
          .eq('facility_id', booking.facility_id)
          .not('line_works_channel_id', 'is', null);

        if (staffList && staffList.length > 0) {
          const { data: customerBooking } = await adminSupabase
            .from('bookings')
            .select('customer_name, menu_id')
            .eq('id', params.id)
            .maybeSingle();

          let menuName = '';
          if (customerBooking?.menu_id) {
            const { data: menu } = await adminSupabase.from('facility_menus').select('name').eq('id', customerBooking.menu_id).maybeSingle();
            menuName = menu?.name || '';
          }

          const text = [
            '🔄 予約変更',
            '',
            `お客様: ${customerBooking?.customer_name || '不明'}`,
            menuName ? `メニュー: ${menuName}` : '',
            `変更後日時: ${parsed.data.booking_date} ${parsed.data.start_time}`,
          ].filter(Boolean).join('\n');

          for (const staff of staffList) {
            if (!staff.line_works_channel_id) continue;
            if (staff.id !== booking.staff_id && !staff.line_works_notify_all) continue;
            changeSideEffects.push(
              sendLineWorksMessage(staff.line_works_channel_id, { content: { type: 'text', text } })
                .catch((e) => safeCaptureException(e, 'change-lineworks'))
            );
          }
        }
      } catch (e) {
        safeCaptureException(e, 'change-lineworks-setup');
      }
    }

    // レスポンス返却前に副作用を確実に完了させる（waitUntil 後処理が本番で全滅していた恒久根治）。
    await Promise.allSettled(changeSideEffects);

    return NextResponse.json({ success: true });
  } catch (e) {
    safeCaptureException(e, 'booking-change');
    // catch して 500 を返すと instrumentation.ts の onRequestError に伝播せず Slack 通知が漏れるため明示通知。
    alertCaughtError('booking-change', e, '/api/booking/[id]/change');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

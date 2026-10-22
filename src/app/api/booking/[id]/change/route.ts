import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { serverError, authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';
import { databaseDiagnostic } from '@/lib/database-diagnostic';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { writeAuditLog } from '@/lib/audit-logger';
import { getTodayString, getMaxDateString } from '@/lib/validations-booking';
import { isValidIsoDate } from '@/lib/date-utils';
import { hasBookingStarted } from '@/lib/cancel-fee';
import { isCustomerChangeableStatus } from '@/lib/booking-status';

export const dynamic = 'force-dynamic';

// キャンセル（/api/booking/[id]/cancel）と同じく、開始時刻を過ぎた予約はオンラインで動かせない。
const ALREADY_STARTED_MESSAGE = '予約開始時刻を過ぎているため、オンラインでの日時変更はできません。施設へ直接ご連絡ください。';

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

    const verification = await verifyAuthUser(supabase.auth);
    if (verification.state === 'unavailable') return authUnavailable('booking-change-auth', '/api/booking/[id]/change');
    if (verification.state !== 'verified') {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    const user = verification.user;

    // Fetch existing booking
    const { data: booking, error: bookingReadError } = await supabase
      .from('bookings')
      .select('id, user_id, status, facility_id, staff_id, booking_date, start_time')
      .eq('id', params.id)
      .maybeSingle();

    if (bookingReadError) return serverError('booking-change-read', databaseDiagnostic(bookingReadError), '/api/booking/[id]/change', '予約を確認できません。時間をおいて再確認してください。');
    if (!booking) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    if (booking.user_id !== user.id) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    if (!isCustomerChangeableStatus(booking.status)) {
      return NextResponse.json({ error: 'この予約は変更できません' }, { status: 400 });
    }
    // 開始時刻（JST）を過ぎた予約の変更は受け付けない。来店しなかった予約を別の日へ動かせると、
    // 無断キャンセルの記録や当日の枠の扱いを店舗が判断できなくなる。最終判定は RPC でも行う。
    if (hasBookingStarted(booking.booking_date, booking.start_time, Date.now())) {
      return NextResponse.json({ error: ALREADY_STARTED_MESSAGE }, { status: 409 });
    }

    // 競合チェック＋UPDATE を change_booking_atomic で同一トランザクション・同一 advisory lock
    // 下に実行（TOCTOU 解消）。指名なし(staff_id NULL)もアクティブ施術者数までの容量判定を行う
    // （旧実装は指名なしの競合チェックを完全スキップしていた）。所有権・状態も RPC 内で再検査。
    // DB-2: change_booking_atomic は所有権を p_user_id パラメータのみで判定するため、直接 PostgREST
    // で呼ぶと booking_id と被害者 user_id を渡すだけで他人の予約をリスケできる IDOR だった。RPC は
    // service_role で呼び、migration 側で anon/authenticated の EXECUTE を撤回して直接呼び出しを塞ぐ。
    // 所有権(booking.user_id === user.id)・状態は上の同期ブロックでサーバ側検証済み。
    const rpcClient = createServiceRoleClient();
    const { data: changed, error } = await rpcClient.rpc('change_customer_booking_with_channels_atomic', {
      p_booking_id: params.id,
      p_user_id: user.id,
      p_booking_date: parsed.data.booking_date,
      p_start_time: parsed.data.start_time,
      p_end_time: parsed.data.end_time,
      // 公開経路は営業時間・定休日・指名スタッフ勤務窓ゲートを RPC 側で強制する（get_available_slots
      // が UI に出さない枠へ API 直叩きで変更できた非対称の根治・2026年7月16日）。admin の手動予約
      // （電話受付等）は意図的にゲート対象外＝パラメータ省略（DEFAULT FALSE）。
      p_enforce_schedule: true,
    });

    if (error) {
      if (error.message?.includes('BOOKING_NOT_READY')) {
        return NextResponse.json({ error: 'この店舗のネット予約は準備中です。予約変更は店舗へお問い合わせください' }, { status: 409 });
      }
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
      if (msg.includes('BOOKING_ALREADY_STARTED')) {
        return NextResponse.json({ error: ALREADY_STARTED_MESSAGE }, { status: 409 });
      }
      // スケジュールゲート（p_enforce_schedule=true で RPC が RAISE・2026年7月16日）。
      // UI(get_available_slots) が出さない枠への変更を、時間帯利用不可＝BOOKING_CONFLICT と
      // 同じ流儀の 409 で拒否する。
      if (msg.includes('BOOKING_CLOSED_DAY')) {
        return NextResponse.json({ error: 'この日は定休日のため予約できません' }, { status: 409 });
      }
      if (msg.includes('BOOKING_OUTSIDE_HOURS')) {
        return NextResponse.json({ error: '営業時間外のため予約できません' }, { status: 409 });
      }
      if (msg.includes('STAFF_NOT_WORKING')) {
        return NextResponse.json({ error: '担当スタッフはこの日時には勤務していません' }, { status: 409 });
      }
      return serverError('booking-change-rpc', databaseDiagnostic(error), '/api/booking/[id]/change', '変更に失敗しました');
    }

    if (!changed || changed.length !== 1 || changed[0].id !== params.id || typeof changed[0].replayed !== 'boolean') {
      return serverError('booking-change-receipt', new Error('booking change receipt unavailable'), '/api/booking/[id]/change', '変更結果を確認できません。ページを更新してください。');
    }
    if (changed[0].replayed) return NextResponse.json({ success: true });

    void writeAuditLog({
      userId: user.id,
      facilityId: booking.facility_id,
      action: 'update',
      tableName: 'bookings',
      recordId: params.id,
      newValues: { booking_date: parsed.data.booking_date, start_time: parsed.data.start_time, end_time: parsed.data.end_time },
      ipAddress: ip,
    });

    // All notification intents committed with the booking; only the worker sends.

    return NextResponse.json({ success: true });
  } catch (e) {
    return serverError('booking-change', e, '/api/booking/[id]/change');
  }
}

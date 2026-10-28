import { serverError, authUnavailable } from '@/lib/with-route';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { verifyAuthUser } from '@/lib/auth-verification';
import { isCustomerChangeableStatus } from '@/lib/booking-status';
import { NextResponse } from 'next/server';
import type { AvailableSlot } from '@/types';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { isValidIsoDate } from '@/lib/date-utils';
import { checkBookingReadiness } from '@/lib/facility-publish-gate';
import { clampDuration, loadSlotHolidayCalendar, readDatedSlots } from '@/lib/available-slots';
import { SLOTS_WEEK_MAX_STAFF as MAX_STAFF, SLOTS_WEEK_MAX_DATES as MAX_DATES } from '@/lib/slots-week';

export const dynamic = 'force-dynamic';

/**
 * 予約画面の日時マトリクス（スタッフ×最大7日）を 1 リクエストで返す（2026年10月22日）。
 *
 * 以前は画面が「スタッフ数×7日」回 /api/slots を叩いていた（2人で14回/週）。/api/slots は
 * 1 IP あたり毎分30回なので、表を開いて「次の7日」を2回押すだけで上限を超え、
 * 「空き状況を確認できませんでした」になって予約できなかった（携帯回線の共有 IP ではさらに起きやすい）。
 * 上限は緩めず、1 週の表示を 1 回に数えることで解消する。
 *
 * 1 組でも取得に失敗したら全体を 500 にする。部分的な空配列を返すと、失敗が「満席」に
 * 見えてしまうため（/api/slots と同じ方針）。
 *
 * excludeBookingId（任意・2026年10月23日）: 予約日時の変更画面が、変更しようとしている予約そのものを
 * 「埋まっている枠」に数えないために渡す。以前は自分の予約（例 14:00〜15:00）と重なる 13:30・14:00・
 * 14:30 が「空きなし」になり、30分〜1時間ずらす変更が画面から選べなかった（変更 API 側の RPC は
 * 自分の予約を除いて判定するので、送れば通る＝画面だけが選ばせていなかった）。
 * 他人の予約を外した空きを引くと、その予約の時間が分かってしまう。そこで指定があるときだけ
 * ログインを求め、本人の予約で、同じ施設の、まだ変更できる状態のものに限って外す。
 */
export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    if (await checkRateLimit(null, ip, 30, 60_000, 'slots-week')) {
      return NextResponse.json({ error: 'リクエストが多すぎます', days: {} }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const facilityId = searchParams.get('facilityId') ?? '';
    const staffIds = [...new Set((searchParams.get('staffIds') ?? '').split(',').filter(Boolean))];
    const dates = [...new Set((searchParams.get('dates') ?? '').split(',').filter(Boolean))];
    const duration = clampDuration(searchParams.get('duration'));

    const excludeBookingId = searchParams.get('excludeBookingId');

    const valid = uuidRegex.test(facilityId)
      && staffIds.length > 0 && staffIds.length <= MAX_STAFF && staffIds.every((id) => uuidRegex.test(id))
      && dates.length > 0 && dates.length <= MAX_DATES && dates.every((d) => isValidIsoDate(d))
      && (excludeBookingId === null || uuidRegex.test(excludeBookingId));
    if (!valid) return NextResponse.json({ error: 'リクエストが不正です', days: {} }, { status: 400 });

    if (excludeBookingId !== null) {
      const auth = await createServerSupabaseAuthClient();
      const verification = await verifyAuthUser(auth.auth);
      if (verification.state === 'unavailable') return authUnavailable('slots-week-auth', '/api/slots/week');
      if (verification.state !== 'verified') return NextResponse.json({ error: '認証が必要です', days: {} }, { status: 401 });
      // RLS（本人の予約だけが読める）に加えて、本人・施設・状態をここで確かめる。
      const { data: own, error: ownError } = await auth
        .from('bookings')
        .select('user_id, facility_id, status')
        .eq('id', excludeBookingId)
        .maybeSingle();
      if (ownError) return serverError('slots-week:exclude-booking', ownError, '/api/slots/week', '予約を確認できません', { days: {} });
      if (!own || own.user_id !== verification.user.id || own.facility_id !== facilityId || !isCustomerChangeableStatus(own.status)) {
        return NextResponse.json({ error: '予約が見つかりません', days: {} }, { status: 404 });
      }
    }

    const preparation = await checkBookingReadiness(createServerSupabaseClient(), facilityId);
    if (preparation.error) return serverError('slots-week:preparation', preparation.error, '/api/slots/week', '予約設定を確認できません', { days: {} });
    if (!preparation.readiness.ready) return NextResponse.json({ days: {}, bookingAvailable: false });

    const admin = createServiceRoleClient();
    const policy = await loadSlotHolidayCalendar(admin, facilityId);
    if (policy.error) return serverError('slots-week:holiday-calendar', policy.error, '/api/slots/week', '営業時間を確認できません', { days: {} });
    const pairs = dates.flatMap((date) => staffIds.map((staffId) => ({ date, staffId })));
    const reads = await Promise.all(pairs.map(({ date, staffId }) =>
      readDatedSlots(admin, facilityId, staffId, date, duration, policy.calendar, excludeBookingId ?? undefined)));
    const failed = reads.find((r) => r.error);
    if (failed) return serverError('slots-week:get_available_slots', failed.error, '/api/slots/week', 'サーバーエラーが発生しました', { days: {} });

    const days: Record<string, Record<string, AvailableSlot[]>> = {};
    pairs.forEach(({ date, staffId }, i) => {
      // failed を除いた後なので slots は必ず配列（readSlots は error が無いとき slots を返す）。
      (days[date] ??= {})[staffId] = reads[i].slots as AvailableSlot[];
    });
    return NextResponse.json({ days });
  } catch (e) {
    return serverError('slots-week', e, '/api/slots/week', 'サーバーエラーが発生しました', { days: {} });
  }
}

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { serverError } from '@/lib/with-route';
import { todayJst } from '@/lib/admin-date';
import { checkBookingReadiness } from '@/lib/facility-publish-gate';
import { readCompleteAvailabilityStaff, readCompleteMonthAvailability, countConfirmedAvailabilitySlots } from '@/lib/availability-results';
import { dropStartedSlotsToday } from '@/lib/available-slots';
import type { AvailableSlot } from '@/types';

/**
 * カレンダー1日分の状態。
 * - available / few / full … 営業日で、空き枠が 3以上 / 1〜2 / 0
 * - closed … 施設の定休日（business_hours の当該曜日が null）。満席とは意味が違う
 * - past   … 過ぎた日。予約できないが「満席」ではない
 * 数値 slots は status 判定用に 3 で丸めた内部値であり、客に見せる残り枠数ではない。
 */
export type AvailabilityStatus = 'available' | 'few' | 'full' | 'closed' | 'past';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    if (await checkRateLimit(null, ip, 10, 60_000, 'availability')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const facilityId = searchParams.get('facilityId');
    const staffId = searchParams.get('staffId');
    const year = parseInt(searchParams.get('year') || '');
    const month = parseInt(searchParams.get('month') || '');

    if (!facilityId || !uuidRegex.test(facilityId)) {
      return NextResponse.json({ error: '施設IDが不正です' }, { status: 400 });
    }
    if (staffId && !uuidRegex.test(staffId)) {
      return NextResponse.json({ error: 'スタッフIDが不正です' }, { status: 400 });
    }
    const currentYear = new Date().getFullYear();
    if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12 || year < currentYear - 1 || year > currentYear + 2) {
      return NextResponse.json({ error: '年月が不正です' }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    // Availability RPCs are SECURITY DEFINER and not executable by anon; run them only from this rate-limited route.
    const rpcClient = createServiceRoleClient();
    const preparation = await checkBookingReadiness(supabase, facilityId);
    if (preparation.error) return serverError('availability-preparation', preparation.error, '/api/availability');
    if (!preparation.readiness.ready) return NextResponse.json({ dates: {}, bookingAvailable: false });

    // Get all staff for this facility if staffId is not provided
    let staffIds: string[] = [];
    if (staffId) {
      staffIds = [staffId];
    } else {
      staffIds = await readCompleteAvailabilityStaff(async (afterId) => {
        let query = supabase.from('staff_profiles').select('id')
          .eq('facility_id', facilityId).eq('is_active', true).order('id').limit(100);
        if (afterId) query = query.gt('id', afterId);
        return await query;
      });
    }

    if (staffIds.length === 0) {
      return NextResponse.json({ dates: {} });
    }

    // Calculate date range for the month
    const daysInMonth = new Date(year, month, 0).getDate();
    // 「過去日」判定は JST の YYYY-MM-DD 文字列比較で行う。旧実装はサーバ(Vercel=UTC)の
    // new Date()+setHours を JST 日付文字列と比較しており、JST 0:00〜8:59 に当日を過去扱い
    // →「満枠」誤表示していた（UTC/JST 混在バグ）。dateStrFor と todayJst() は同形式。
    const todayStr = todayJst();

    const dateStrFor = (day: number) =>
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isPast = (dateStr: string) => dateStr < todayStr;

    // 【2026年7月30日 追加・休業日と満席の区別】
    // 本番実測で、定休日（訪問専門 神原鍼灸院の木曜）の施設ページに赤字点滅で「本日満枠」と
    // 表示されていた。休んでいる日を「満席＝人気で埋まっている」と見せるのは事実に反する。
    // 原因は status に休業を表す状態が無く、0 枠を一律 full にしていたこと。
    // get_available_slots（20260703000004）と同じ規約で business_hours を読み、定休日を分ける。
    //   - business_hours 自体が未設定 → ゲートしない（SQL 側と同じ後方互換）
    //   - 曜日キーが存在して値が null → 定休日
    //   - 曜日キーが無い → ゲートしない
    const { data: facRow, error: hoursError } = await supabase
      .from('facility_profiles')
      .select('business_hours')
      .eq('id', facilityId)
      .maybeSingle();
    if (hoursError) return serverError('availability-hours', hoursError, '/api/availability');
    const businessHours = (facRow?.business_hours ?? null) as Record<string, unknown> | null;
    const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
    const isClosedOn = (dateStr: string): boolean => {
      if (!businessHours) return false;
      const key = DAY_KEYS[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
      if (!(key in businessHours)) return false;
      return businessHours[key] == null;
    };

    // slots は「status 判定用に 3 で丸めた内部値」であり、客に見せる残り枠数ではない。
    // 実際に 45 枠空いている日でも 3 を返すため、この数値をそのまま「本日残り3枠」と
    // 表示すると誤った希少性の演出になる（本番で発生していた）。表示側は status を使うこと。
    const summarize = (total: number): { slots: number; status: AvailabilityStatus } => {
      const slots = Math.min(total, 3);
      return { slots, status: slots >= 3 ? 'available' : slots >= 1 ? 'few' : 'full' };
    };
    const summarizeDay = (dateStr: string, total: number): { slots: number; status: AvailabilityStatus } =>
      isClosedOn(dateStr) ? { slots: 0, status: 'closed' } : summarize(total);

    const dates: Record<string, { slots: number; status: AvailabilityStatus }> = {};

    // 集約 RPC で「月 × 全スタッフ」のスロット数を 1 ラウンドトリップで取得（N+1 解消）。
    // get_month_availability 未デプロイ時（PostgREST schema cache 未反映含む = PGRST202）のみ
    // 従来の日次ループにフォールバックし、DB マイグレーション適用とコードデプロイの順序に依存せず無停止とする。
    const { data: monthRows, error: monthErr } = await rpcClient.rpc('get_month_availability', {
      p_facility_id: facilityId,
      p_staff_ids: staffIds,
      p_year: year,
      p_month: month,
      p_duration_minutes: 60,
    });

    // 1日分を get_available_slots で数え直す（3 枠に届いた時点で打ち切る）。
    // 当日は開始時刻（JST）を過ぎた枠を数えない＝予約画面（/api/slots）と同じ規則。
    // 集約 RPC は日単位の件数しか返さず「今より後か」を知らないため、当日の「本日空き」が
    // 既に過ぎた朝の枠まで数えていた（検索バッジで是正済みの不具合と同じ型・2026年10月23日）。
    const countDaySlots = async (dateStr: string): Promise<number> => {
      let totalSlots = 0;
      for (const sid of staffIds) {
        const { data, error: slotsError } = await rpcClient.rpc('get_available_slots', {
          p_facility_id: facilityId,
          p_staff_id: sid,
          p_date: dateStr,
          p_duration_minutes: 60,
        });
        // 再計算も失敗したら「満席0件」と成功応答しない。
        if (slotsError) throw new Error('Availability fallback slot lookup failed');
        countConfirmedAvailabilitySlots(data);
        totalSlots += dropStartedSlotsToday(dateStr, data as AvailableSlot[]).length;
        if (totalSlots >= 3) break;
      }
      return totalSlots;
    };

    if (!monthErr) {
      const slotMap = readCompleteMonthAvailability(monthRows, year, month);
      // 当日がこの月にあり休業日でなければ、当日だけ「これから始まる枠」で数え直す。
      if (slotMap.has(todayStr) && !isClosedOn(todayStr)) {
        slotMap.set(todayStr, await countDaySlots(todayStr));
      }
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = dateStrFor(day);
        dates[dateStr] = isPast(dateStr)
          ? { slots: 0, status: 'past' }
          : summarizeDay(dateStr, slotMap.get(dateStr)!);
      }
      return NextResponse.json({ dates });
    }

    // 集約RPCが失敗した場合（未デプロイ / PostgREST schema cache 未反映 / ランタイムエラーの
    // いずれでも）500 にせず従来の日次ループにフォールバックする。フォールバックは実データを
    // 再計算するため「空状態偽装」にはならず、公開導線（施設ページのバッジ）を止めない。
    // 原因可視化のため記録する（cache 反映＆関数正常後は到達しないため恒常ノイズにならない）。
    safeCaptureException(monthErr, 'availability:get_month_availability_fallback');
    alertCaughtError('availability:get_month_availability_fallback', monthErr, '/api/availability');

    // ---- フォールバック（集約RPCが使えない間の互換経路。cache 反映＆関数正常後は到達しない）----
    const futureDates: string[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = dateStrFor(day);
      if (isPast(dateStr)) {
        dates[dateStr] = { slots: 0, status: 'past' };
      } else {
        futureDates.push(dateStr);
      }
    }

    const BATCH_SIZE = 5;
    for (let i = 0; i < futureDates.length; i += BATCH_SIZE) {
      const batch = futureDates.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (dateStr) => {
        dates[dateStr] = summarizeDay(dateStr, await countDaySlots(dateStr));
      }));
    }

    return NextResponse.json({ dates });
  } catch (e) {
    return serverError('availability', e, '/api/availability');
  }
}

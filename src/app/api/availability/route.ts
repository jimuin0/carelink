import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { todayJst } from '@/lib/admin-date';

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

    // Get all staff for this facility if staffId is not provided
    let staffIds: string[] = [];
    if (staffId) {
      staffIds = [staffId];
    } else {
      const { data: staffList, error: staffErr } = await supabase
        .from('staff_profiles')
        .select('id')
        .eq('facility_id', facilityId)
        .eq('is_active', true)
        .limit(10);
      // error を握り潰すと staffIds=[] → {dates:{}} を静かに返し「空きカレンダー」を偽装する
      // （DB障害を『予約不可』に化けさせる）。slots ルートと同じく 500 で顕在化させる。
      if (staffErr) {
        safeCaptureException(staffErr, 'availability:staff_profiles');
        alertCaughtError('availability:staff_profiles', staffErr, '/api/availability');
        return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
      }
      staffIds = (staffList || []).map((s: { id: string }) => s.id);
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
    const { data: facRow } = await supabase
      .from('facility_profiles')
      .select('business_hours')
      .eq('id', facilityId)
      .maybeSingle();
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
    const { data: monthRows, error: monthErr } = await supabase.rpc('get_month_availability', {
      p_facility_id: facilityId,
      p_staff_ids: staffIds,
      p_year: year,
      p_month: month,
      p_duration_minutes: 60,
    });

    if (!monthErr) {
      const slotMap = new Map<string, number>();
      for (const row of (monthRows ?? []) as { d: string; slots: number }[]) {
        slotMap.set(row.d, row.slots);
      }
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = dateStrFor(day);
        dates[dateStr] = isPast(dateStr)
          ? { slots: 0, status: 'past' }
          : summarizeDay(dateStr, slotMap.get(dateStr) ?? 0);
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
        let totalSlots = 0;
        for (const sid of staffIds) {
          const { data } = await supabase.rpc('get_available_slots', {
            p_facility_id: facilityId,
            p_staff_id: sid,
            p_date: dateStr,
            p_duration_minutes: 60,
          });
          totalSlots += (data || []).length;
          if (totalSlots >= 3) break;
        }
        dates[dateStr] = summarizeDay(dateStr, totalSlots);
      }));
    }

    return NextResponse.json({ dates });
  } catch (e) {
    safeCaptureException(e, 'availability');
    alertCaughtError('availability', e, '/api/availability');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { safeCaptureException } from '@/lib/safe';
import { getTodayString } from '@/lib/validations-booking';

export const dynamic = 'force-dynamic';

// 空きスロット合計から月カレンダー表示ステータスを導出する（単一の閾値ロジック・両経路で共用）。
function statusOf(totalSlots: number): 'available' | 'few' | 'full' {
  return totalSlots >= 3 ? 'available' : totalSlots >= 1 ? 'few' : 'full';
}

export async function GET(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (inMemoryRateLimit(ip, 10, 60_000, 'availability')) {
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
      const { data: staffList } = await supabase
        .from('staff_profiles')
        .select('id')
        .eq('facility_id', facilityId)
        .eq('is_active', true)
        .limit(10);
      staffIds = (staffList || []).map((s: { id: string }) => s.id);
    }

    if (staffIds.length === 0) {
      return NextResponse.json({ dates: {} });
    }

    // Calculate date range for the month
    const daysInMonth = new Date(year, month, 0).getDate();
    // 過去日判定は JST の 'YYYY-MM-DD' 文字列比較に統一（setHours はサーバTZ依存=Vercel UTC で1日ズレるため）。
    // bookingSchema の過去判定(>= getTodayString())と同一規約にして表示と確定の境界を一致させる。
    const todayStr = getTodayString();

    const dates: Record<string, { slots: number; status: 'available' | 'few' | 'full' }> = {};

    // Build list of future dates to check
    const futureDates: string[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (dateStr < todayStr) {
        dates[dateStr] = { slots: 0, status: 'full' };
      } else {
        futureDates.push(dateStr);
      }
    }

    // 注: 日別受付上限/時間帯停止の表示反映は slots(時間選択画面)で行い、最終的な可否は確定層RPC(20260603_booking_gates.sql)が
    //     DBレベルで強制する。月カレンダー(本API)は粗いヒントのため当該反映は意図的に行わない。
    //
    // 集約RPC get_month_availability で日数×スタッフの空き集計を「1往復」で取得する（#G・最悪310往復の解消）。
    // 同RPCは内部で get_available_slots に委譲＝空き判定は単一ソースのまま。未適用/失敗時は従来の
    // per-date ループへ自動フォールバックし無退行（correctness を常に担保）。status 導出は JS 側で共用する。
    let aggregated: { d: string; slots: number | null }[] | null = null;
    try {
      const { data, error } = await supabase.rpc('get_month_availability', {
        p_facility_id: facilityId,
        p_staff_ids: staffIds,
        p_dates: futureDates,
        p_duration_minutes: 60,
      });
      if (!error && Array.isArray(data)) {
        aggregated = data as { d: string; slots: number | null }[];
      }
    } catch {
      // 集約RPCが使えない環境はフォールバックする（本処理は下の per-date ループで継続）
    }

    if (aggregated) {
      for (const row of aggregated) {
        const totalSlots = row.slots ?? 0;
        dates[row.d] = { slots: totalSlots, status: statusOf(totalSlots) };
      }
      // RPC が返さなかった将来日は full 扱い（防御・取りこぼし無し）
      for (const dateStr of futureDates) {
        if (!dates[dateStr]) dates[dateStr] = { slots: 0, status: 'full' };
      }
    } else {
      // フォールバック: 日付ごとに get_available_slots を呼ぶ従来実装（5日並列＋早期終了）。
      const BATCH_SIZE = 5;
      for (let i = 0; i < futureDates.length; i += BATCH_SIZE) {
        const batch = futureDates.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (dateStr) => {
          let totalSlots = 0;

          // Check slots for each staff member sequentially per date
          for (const sid of staffIds) {
            const { data } = await supabase.rpc('get_available_slots', {
              p_facility_id: facilityId,
              p_staff_id: sid,
              p_date: dateStr,
              p_duration_minutes: 60,
            });
            totalSlots += (data || []).length;
            // Early exit: once we know enough slots exist, skip remaining staff
            if (totalSlots >= 3) break;
          }

          dates[dateStr] = { slots: totalSlots, status: statusOf(totalSlots) };
        }));
      }
    }

    return NextResponse.json({ dates });
  } catch (e) {
    safeCaptureException(e, 'availability');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

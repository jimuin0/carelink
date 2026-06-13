import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { safeCaptureException } from '@/lib/safe';

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dateStrFor = (day: number) =>
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isPast = (dateStr: string) => new Date(dateStr + 'T00:00:00+09:00') < today;
    // 旧実装はスタッフループの早期 break により slots を実質 3 前後に丸めていた。集約後も
    // status 閾値（>=3 available / >=1 few / 0 full）と表示 regime（RemainingSlots）を一致させるため 3 で丸める。
    const summarize = (total: number): { slots: number; status: 'available' | 'few' | 'full' } => {
      const slots = Math.min(total, 3);
      return { slots, status: slots >= 3 ? 'available' : slots >= 1 ? 'few' : 'full' };
    };

    const dates: Record<string, { slots: number; status: 'available' | 'few' | 'full' }> = {};

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
        dates[dateStr] = isPast(dateStr) ? { slots: 0, status: 'full' } : summarize(slotMap.get(dateStr) ?? 0);
      }
      return NextResponse.json({ dates });
    }

    // 集約関数の未デプロイ以外（通信/権限/SQL エラー）は異常として扱い 500 を返す（空状態に偽装しない）。
    if (monthErr.code !== 'PGRST202') {
      throw monthErr;
    }

    // ---- フォールバック（get_month_availability 適用前の互換経路。適用・cache 反映後は到達しない）----
    const futureDates: string[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = dateStrFor(day);
      if (isPast(dateStr)) {
        dates[dateStr] = { slots: 0, status: 'full' };
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
        dates[dateStr] = summarize(totalSlots);
      }));
    }

    return NextResponse.json({ dates });
  } catch (e) {
    safeCaptureException(e, 'availability');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

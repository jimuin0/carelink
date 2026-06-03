import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { safeCaptureException } from '@/lib/safe';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dates: Record<string, { slots: number; status: 'available' | 'few' | 'full' }> = {};

    // Build list of future dates to check
    const futureDates: string[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dateObj = new Date(dateStr + 'T00:00:00+09:00');
      if (dateObj < today) {
        dates[dateStr] = { slots: 0, status: 'full' };
      } else {
        futureDates.push(dateStr);
      }
    }

    // Process dates in batches to limit concurrent DB calls
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

        const status: 'available' | 'few' | 'full' =
          totalSlots >= 3 ? 'available' : totalSlots >= 1 ? 'few' : 'full';
        dates[dateStr] = { slots: totalSlots, status };
      }));
    }

    return NextResponse.json({ dates });
  } catch (e) {
    safeCaptureException(e, 'availability');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

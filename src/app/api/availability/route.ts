import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';

export async function GET(request: Request) {
  try {
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
    if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
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
        .limit(50);
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

    // Query each date in parallel (batched)
    const promises: Promise<void>[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dateObj = new Date(dateStr + 'T00:00:00+09:00');

      // Skip past dates
      if (dateObj < today) {
        dates[dateStr] = { slots: 0, status: 'full' };
        continue;
      }

      const promise = (async () => {
        let totalSlots = 0;

        // Check slots for each staff member
        for (const sid of staffIds) {
          const { data } = await supabase.rpc('get_available_slots', {
            p_facility_id: facilityId,
            p_staff_id: sid,
            p_date: dateStr,
            p_duration_minutes: 60,
          });
          totalSlots += (data || []).length;
        }

        let status: 'available' | 'few' | 'full';
        if (totalSlots >= 3) {
          status = 'available';
        } else if (totalSlots >= 1) {
          status = 'few';
        } else {
          status = 'full';
        }

        dates[dateStr] = { slots: totalSlots, status };
      })();

      promises.push(promise);
    }

    await Promise.all(promises);

    return NextResponse.json({ dates });
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

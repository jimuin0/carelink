import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import type { AvailableSlot } from '@/types';
import { UUID_REGEX as uuidRegex, NON_OCCUPYING_STATUS_FILTER } from '@/lib/constants';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { safeCaptureException } from '@/lib/safe';
import { isRangeSuspended, type SuspensionRange } from '@/lib/suspensions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'slots')) {
    return NextResponse.json({ error: 'リクエストが多すぎます', slots: [] }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get('facilityId');
  const staffId = searchParams.get('staffId');
  const date = searchParams.get('date');
  const rawDuration = parseInt(searchParams.get('duration') || '60');
  const duration = Number.isNaN(rawDuration) ? 60 : Math.min(Math.max(rawDuration, 15), 480);
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  if (!facilityId || !staffId || !date) {
    return NextResponse.json({ slots: [] });
  }
  if (!uuidRegex.test(facilityId) || !uuidRegex.test(staffId) || !dateRegex.test(date)) {
    return NextResponse.json({ slots: [] });
  }

  const supabase = createServerSupabaseClient();
  // #03: 非公開(draft/suspended)施設はネット予約不可。確定層(RPC)が権威だが、表示層も空スロットで一致させる。
  // anon RLS は published 行のみ可視のため、行が取れない=非公開→空スロット。
  const { data: fac } = await supabase
    .from('facility_profiles').select('status').eq('id', facilityId).maybeSingle();
  if ((fac as { status: string } | null)?.status !== 'published') {
    return NextResponse.json({ slots: [] });
  }

  const { data } = await supabase.rpc('get_available_slots', {
    p_facility_id: facilityId,
    p_staff_id: staffId,
    p_date: date,
    p_duration_minutes: duration,
  });

  let slots = (data ?? []) as AvailableSlot[];
  if (slots.length > 0) {
    // 停止範囲・日別受付上限は相互に独立 → 並列取得で直列レイテンシを削減（round4 perf #E）
    const [{ data: sus }, { data: cap }] = await Promise.all([
      // 時間帯停止(#03/#09/#10): 当該日の停止範囲に重なるスロットを除外
      supabase
        .from('facility_booking_suspensions').select('start_time, end_time')
        .eq('facility_id', facilityId).eq('suspend_date', date),
      // 受付可能枠数（日別 #05/#46）: 当日の予約数が上限に達していれば当日のネット予約を停止
      supabase
        .from('facility_daily_capacity').select('max_bookings')
        .eq('facility_id', facilityId).eq('capacity_date', date).maybeSingle(),
    ]);
    if (sus && sus.length > 0) {
      const ranges = sus as SuspensionRange[];
      slots = slots.filter((s) => !isRangeSuspended(s.slot_start, s.slot_end, ranges));
    }
    const maxBookings = (cap as { max_bookings: number } | null)?.max_bookings;
    if (typeof maxBookings === 'number') {
      const { count } = await supabase
        .from('bookings').select('id', { count: 'exact', head: true })
        .eq('facility_id', facilityId).eq('booking_date', date).not('status', 'in', NON_OCCUPYING_STATUS_FILTER);
      if ((count ?? 0) >= maxBookings) slots = [];
    }
  }

  return NextResponse.json({ slots });
  } catch (e) {
    safeCaptureException(e, 'slots');
    return NextResponse.json({ error: 'サーバーエラーが発生しました', slots: [] }, { status: 500 });
  }
}

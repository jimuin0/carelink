import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import type { AvailableSlot } from '@/types';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
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
  const { data } = await supabase.rpc('get_available_slots', {
    p_facility_id: facilityId,
    p_staff_id: staffId,
    p_date: date,
    p_duration_minutes: duration,
  });

  let slots = (data ?? []) as AvailableSlot[];
  // 時間帯停止(#03/#09/#10): 当該日の停止範囲に重なるスロットを除外（スロットが無ければ問い合わせ不要）
  if (slots.length > 0) {
    const { data: sus } = await supabase
      .from('facility_booking_suspensions').select('start_time, end_time')
      .eq('facility_id', facilityId).eq('suspend_date', date);
    if (sus && sus.length > 0) {
      const ranges = sus as SuspensionRange[];
      slots = slots.filter((s) => !isRangeSuspended(s.slot_start, s.slot_end, ranges));
    }
  }

  return NextResponse.json({ slots });
  } catch (e) {
    safeCaptureException(e, 'slots');
    return NextResponse.json({ error: 'サーバーエラーが発生しました', slots: [] }, { status: 500 });
  }
}

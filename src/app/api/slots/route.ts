import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import type { AvailableSlot } from '@/types';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { safeCaptureException } from '@/lib/safe';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
  const ip = getClientIp(request);
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

  return NextResponse.json({ slots: (data ?? []) as AvailableSlot[] });
  } catch (e) {
    safeCaptureException(e, 'slots');
    return NextResponse.json({ error: 'サーバーエラーが発生しました', slots: [] }, { status: 500 });
  }
}

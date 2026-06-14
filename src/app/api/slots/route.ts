import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import type { AvailableSlot } from '@/types';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { safeCaptureException } from '@/lib/safe';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'slots')) {
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
  const { data, error } = await supabase.rpc('get_available_slots', {
    p_facility_id: facilityId,
    p_staff_id: staffId,
    p_date: date,
    p_duration_minutes: duration,
  });

  // 取得失敗を「空き枠なし」に偽装しない。RPC エラーを握り潰すと、過去の booking_buffer_minutes
  // スキーマドリフトのように予約導線が無監視で壊れる（空配列＝予約不可がサイレントに発生）。
  // Sentry に記録し 500 を返して失敗を顕在化させる。
  if (error) {
    safeCaptureException(error, 'slots:get_available_slots');
    return NextResponse.json({ error: 'サーバーエラーが発生しました', slots: [] }, { status: 500 });
  }

  return NextResponse.json({ slots: (data ?? []) as AvailableSlot[] });
  } catch (e) {
    safeCaptureException(e, 'slots');
    return NextResponse.json({ error: 'サーバーエラーが発生しました', slots: [] }, { status: 500 });
  }
}

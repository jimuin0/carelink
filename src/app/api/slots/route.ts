import { serverError } from '@/lib/with-route';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { isValidIsoDate } from '@/lib/date-utils';
import { checkBookingReadiness } from '@/lib/facility-publish-gate';
import { clampDuration, readSlots } from '@/lib/available-slots';

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
  const duration = clampDuration(searchParams.get('duration'));

  if (!facilityId || !staffId || !date) {
    return NextResponse.json({ slots: [] });
  }
  // 形式だけでなく実在する暦日かを検証する（2026-02-30 等は Postgres の date キャストで
  // RPC エラー→500/Sentry ノイズになる）。不正日付は空き枠なしとして 200 で返す。
  if (!uuidRegex.test(facilityId) || !uuidRegex.test(staffId) || !isValidIsoDate(date)) {
    return NextResponse.json({ slots: [] });
  }

  const supabase = createServerSupabaseClient();
  const preparation = await checkBookingReadiness(supabase, facilityId);
  if (preparation.error) return serverError('slots:preparation', preparation.error, '/api/slots', '予約設定を確認できません', { slots: [] });
  if (!preparation.readiness.ready) return NextResponse.json({ slots: [], bookingAvailable: false });
  // The slot RPC is SECURITY DEFINER and not executable by anon: only these rate-limited routes may run it.
  const read = await readSlots(createServiceRoleClient(), facilityId, staffId, date, duration);

  // 取得失敗を「空き枠なし」に偽装しない。RPC エラーを握り潰すと、過去の booking_buffer_minutes
  // スキーマドリフトのように予約導線が無監視で壊れる（空配列＝予約不可がサイレントに発生）。
  // Sentry に記録し 500 を返して失敗を顕在化させる。
  if (read.error) {
    // slots: [] を落とすと呼び出し側の画面が undefined を舐めて壊れるため body 形は維持する。
    // Sentry 送信は serverError() の内部で行う（ここで呼ぶと同じ例外が二重計上される）。
    return serverError('slots:get_available_slots', read.error, '/api/slots', 'サーバーエラーが発生しました', { slots: [] });
  }
  const slots = read.slots;

  return NextResponse.json({ slots });
  } catch (e) {
    return serverError('slots', e, '/api/slots', 'サーバーエラーが発生しました', { slots: [] });
  }
}

/**
 * 予約 iCal (.ics) ダウンロード
 * GET /api/booking/[id]/ical
 * Googleカレンダー・Appleカレンダー等にインポート可能
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

function escapeIcal(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function toIcalDate(isoString: string): string {
  return isoString.replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace('Z', 'Z');
}

// 予約日(DATE "YYYY-MM-DD") と時刻(TIME "HH:MM" または "HH:MM:SS") を iCal のローカル日時
// "YYYYMMDDTHHMMSS" に組み立てる。旧実装は日付を持たず start_time/end_time(TIME) だけを
// toIcalDate に通していたため DTSTART/DTEND が "100000" のような日付欠落値になり、
// カレンダー取込が壊れていた。TZID=Asia/Tokyo と併用して JST として正しく解釈させる。
function toIcalLocalDateTime(date: string, time: string): string {
  const d = date.replace(/-/g, '');                 // "YYYYMMDD"
  const t = (time.replace(/:/g, '') + '000000').slice(0, 6); // "HHMMSS"（秒欠落も0埋め）
  return `${d}T${t}`;
}

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'booking-ical')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data: booking } = await admin
    .from('bookings')
    .select('id, user_id, facility_id, booking_date, start_time, end_time, menu:facility_menus(name), staff:staff_profiles(name), facility_profiles(name, address, phone)')
    .eq('id', params.id)
    .single();

  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 本人のみ
  if (booking.user_id !== user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facility = (Array.isArray(booking.facility_profiles) ? booking.facility_profiles[0] : booking.facility_profiles) as {
    name: string; address?: string; phone?: string
  } | null;

  // bookings に menu_name/staff_name 列は無く、menu_id/staff_id 経由で取得する（embed）
  const menu = (Array.isArray(booking.menu) ? booking.menu[0] : booking.menu) as { name: string } | null;
  const staff = (Array.isArray(booking.staff) ? booking.staff[0] : booking.staff) as { name: string } | null;
  const menuName = menu?.name ?? null;
  const staffName = staff?.name ?? null;

  const facilityName = facility?.name ?? 'CareLink 予約';
  const bookingDate = booking.booking_date as string | null;
  const startTime = bookingDate && booking.start_time ? toIcalLocalDateTime(bookingDate, booking.start_time) : '';
  const endTime = bookingDate && booking.end_time ? toIcalLocalDateTime(bookingDate, booking.end_time) : '';
  const uid = `carelink-${booking.id}@carelink-jp.com`;
  const now = toIcalDate(new Date().toISOString());

  const summary = `${facilityName} - ${menuName ?? '施術'}`;
  const description = [
    menuName && `メニュー: ${menuName}`,
    staffName && `担当: ${staffName}`,
    facility?.phone && `電話: ${facility.phone}`,
    `予約ID: ${booking.id.slice(0, 8)}`,
  ].filter(Boolean).join('\n');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CareLink//CareLink Booking//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    startTime && `DTSTART;TZID=Asia/Tokyo:${startTime}`,
    endTime && `DTEND;TZID=Asia/Tokyo:${endTime}`,
    `SUMMARY:${escapeIcal(summary)}`,
    description && `DESCRIPTION:${escapeIcal(description)}`,
    facility?.address && `LOCATION:${escapeIcal(facility.address)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="carelink-booking-${booking.id.slice(0, 8)}.ics"`,
    },
  });
  } catch (e) {
    console.error('[booking/ical] unexpected error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

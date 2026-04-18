/**
 * 予約 iCal (.ics) ダウンロード
 * GET /api/booking/[id]/ical
 * Googleカレンダー・Appleカレンダー等にインポート可能
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';

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

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data: booking } = await admin
    .from('bookings')
    .select('id, user_id, facility_id, start_time, end_time, menu_name, staff_name, notes, facility_profiles(name, address, phone)')
    .eq('id', params.id)
    .single();

  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 本人のみ
  if (booking.user_id !== user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facility = (Array.isArray(booking.facility_profiles) ? booking.facility_profiles[0] : booking.facility_profiles) as {
    name: string; address?: string; phone?: string
  } | null;

  const facilityName = facility?.name ?? 'CareLink 予約';
  const startTime = booking.start_time ? toIcalDate(booking.start_time) : '';
  const endTime = booking.end_time ? toIcalDate(booking.end_time) : '';
  const uid = `carelink-${booking.id}@carelink-jp.com`;
  const now = toIcalDate(new Date().toISOString());

  const summary = `${facilityName} - ${booking.menu_name ?? '施術'}`;
  const description = [
    booking.menu_name && `メニュー: ${booking.menu_name}`,
    booking.staff_name && `担当: ${booking.staff_name}`,
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
    startTime && `DTSTART:${startTime}`,
    endTime && `DTEND:${endTime}`,
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

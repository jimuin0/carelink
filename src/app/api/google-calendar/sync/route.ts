import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Token refresh failed');
  return res.json();
}

// POST /api/google-calendar/sync
// Syncs a booking to Google Calendar
export async function POST(req: NextRequest) {
  try {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'gcal-sync')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bookingId } = await req.json().catch(() => ({}));
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
  if (!UUID_REGEX.test(bookingId)) return NextResponse.json({ error: 'Invalid bookingId' }, { status: 400 });

  const admin = createServiceRoleClient();

  // Verify booking ownership
  const { data: booking } = await admin
    .from('bookings')
    .select('*, facility_profiles(name, address, phone), menus(name)')
    .eq('id', bookingId)
    .eq('user_id', user.id)
    .single();

  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  // Get user's Google token
  const { data: tokenRow } = await admin
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!tokenRow) return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 400 });

  // Refresh token if expired
  let accessToken = tokenRow.access_token;
  if (new Date(tokenRow.expires_at) < new Date() && tokenRow.refresh_token) {
    const refreshed = await refreshAccessToken(tokenRow.refresh_token);
    accessToken = refreshed.access_token;
    const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await admin
      .from('google_calendar_tokens')
      .update({ access_token: accessToken, expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);
  }

  // Build calendar event
  const facilityName = Array.isArray(booking.facility_profiles)
    ? booking.facility_profiles[0]?.name
    : (booking.facility_profiles as { name?: string } | null)?.name;
  const menuName = Array.isArray(booking.menus)
    ? booking.menus[0]?.name
    : (booking.menus as { name?: string } | null)?.name;

  const startDt = new Date(`${booking.booking_date}T${booking.start_time}`);
  const endDt = new Date(startDt.getTime() + (booking.duration_minutes || 60) * 60 * 1000);

  const event = {
    summary: `${facilityName || '施設'} — ${menuName || '予約'}`,
    description: `CareLink 予約 #${bookingId.slice(0, 8)}\n\n予約管理: https://carelink-jp.com/mypage/bookings/${bookingId}`,
    location: (Array.isArray(booking.facility_profiles) ? booking.facility_profiles[0] : booking.facility_profiles as { address?: string } | null)?.address || '',
    start: { dateTime: startDt.toISOString(), timeZone: 'Asia/Tokyo' },
    end: { dateTime: endDt.toISOString(), timeZone: 'Asia/Tokyo' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'email', minutes: 24 * 60 },
      ],
    },
  };

  // Check if event already exists
  const { data: existing } = await admin
    .from('booking_calendar_events')
    .select('google_event_id')
    .eq('booking_id', bookingId)
    .eq('user_id', user.id)
    .single();

  let googleEventId: string;

  if (existing?.google_event_id) {
    // Update existing event
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existing.google_event_id}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }
    );
    if (!res.ok) return NextResponse.json({ error: 'Calendar update failed' }, { status: 500 });
    const data = await res.json();
    googleEventId = data.id;
  } else {
    // Create new event
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }
    );
    if (!res.ok) return NextResponse.json({ error: 'Calendar create failed' }, { status: 500 });
    const data = await res.json();
    googleEventId = data.id;

    await admin.from('booking_calendar_events').upsert({
      booking_id: bookingId,
      user_id: user.id,
      google_event_id: googleEventId,
      calendar_id: 'primary',
      synced_at: new Date().toISOString(),
    }, { onConflict: 'booking_id,user_id' });
  }

  return NextResponse.json({ ok: true, googleEventId });
  } catch (e) {
    console.error('[google-calendar/sync] POST error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE /api/google-calendar/sync?bookingId=xxx — remove event
export async function DELETE(req: NextRequest) {
  try {
    const csrfError = checkCsrf(req);
    if (csrfError) return csrfError;
    const supabase = await createServerSupabaseAuthClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const bookingId = req.nextUrl.searchParams.get('bookingId');
    if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
    if (!UUID_REGEX.test(bookingId)) return NextResponse.json({ error: 'Invalid bookingId' }, { status: 400 });

    const admin = createServiceRoleClient();

    const { data: calEvent } = await admin
      .from('booking_calendar_events')
      .select('google_event_id')
      .eq('booking_id', bookingId)
      .eq('user_id', user.id)
      .single();

    if (!calEvent) return NextResponse.json({ ok: true });

    const { data: tokenRow } = await admin
      .from('google_calendar_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', user.id)
      .single();

    if (tokenRow) {
      let accessToken = tokenRow.access_token;
      if (new Date(tokenRow.expires_at) < new Date() && tokenRow.refresh_token) {
        const refreshed = await refreshAccessToken(tokenRow.refresh_token);
        accessToken = refreshed.access_token;
      }

      await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${calEvent.google_event_id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
      );
    }

    await admin.from('booking_calendar_events').delete()
      .eq('booking_id', bookingId).eq('user_id', user.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[google-calendar/sync] DELETE error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

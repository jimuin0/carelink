import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { authUnavailable, serverError } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';
import { runCalendarOperation, type CalendarCredentials } from '@/lib/calendar-sync-operation';
import { z } from 'zod';
import { bookingCalendarTimes } from '@/lib/booking-calendar-time';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

async function refreshAccessToken(refreshToken: string) {
  const deadline = Date.now() + 10_000;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new Error();
    const data: unknown = await res.json();
    const parsed = z.object({ access_token: z.string().min(1), expires_in: z.number().finite().positive() }).safeParse(data);
    if (!parsed.success || Date.now() >= deadline) throw new Error();
    return parsed.data;
  } catch {
    // JSON parse errors can contain a fragment of the credential response.
    // Never pass the raw exception or its cause to monitoring/logging.
    throw new Error('Calendar token refresh unavailable');
  }
}


async function calendarCredentials(admin: SupabaseClient, userId: string): Promise<CalendarCredentials | null> {
  const result=await admin.from('google_calendar_tokens').select('*').eq('user_id',userId).maybeSingle();
  if(result.error)throw new Error('CALENDAR_CREDENTIAL_READ_UNAVAILABLE');
  if(!result.data)return null;
  const token=result.data;
  if(!UUID_REGEX.test(token.id) || typeof token.access_token!=='string' || !token.access_token || !Number.isFinite(Date.parse(token.updated_at)))throw new Error('CALENDAR_CREDENTIAL_INVALID');
  let accessToken=token.access_token;let updatedAt=token.updated_at;
  if(!Number.isFinite(Date.parse(token.expires_at)) || Date.parse(token.expires_at)<=Date.now()) {
    if(typeof token.refresh_token!=='string'||!token.refresh_token)throw new Error('CALENDAR_REAUTHENTICATION_REQUIRED');
    const refreshed=await refreshAccessToken(token.refresh_token);
    accessToken=refreshed.access_token;updatedAt=new Date().toISOString();
    const expiresAt=new Date(Date.now()+refreshed.expires_in*1000).toISOString();
    const saved=await admin.from('google_calendar_tokens').update({access_token:accessToken,expires_at:expiresAt,updated_at:updatedAt},{count:'exact'}).eq('user_id',userId).eq('id',token.id).eq('updated_at',token.updated_at).select('id, updated_at').maybeSingle();
    if(saved.error || saved.count!==1 || !saved.data || saved.data.id!==token.id || !Number.isFinite(Date.parse(saved.data.updated_at)))throw new Error('CALENDAR_CREDENTIAL_SAVE_UNCONFIRMED');
    updatedAt=saved.data.updated_at;
  }
  return {accessToken,tokenId:token.id,updatedAt};
}
function invalidOperation() {
  return NextResponse.json({code:'CALENDAR_OPERATION_ID_REQUIRED',error:'画面を再読み込みして操作を再確認してください。'},{status:400,headers:{'Cache-Control':'no-store'}});
}

export async function POST(req: NextRequest) {
 try {
  const csrfError=checkCsrf(req);if(csrfError)return csrfError;
  if(await checkRateLimit(null,getClientIp(req),20,60000,'gcal-sync'))return NextResponse.json({error:'Too Many Requests'},{status:429});
  const supabase=await createServerSupabaseAuthClient();const identity=await verifyAuthUser(supabase.auth);
  if(identity.state==='unavailable')return authUnavailable('gcal-sync-auth','/api/google-calendar/sync');
  if(identity.state==='unauthenticated')return NextResponse.json({error:'Unauthorized'},{status:401});
  const user=identity.user;
  const input=await req.json().catch(()=>null);
  if(!input?.bookingId)return NextResponse.json({error:'bookingId required'},{status:400});
  const {bookingId:rawBookingId,operationId:rawOperationId}=input;
  const bookingId=typeof rawBookingId==='string'?rawBookingId.toLowerCase():rawBookingId;
  const operationId=typeof rawOperationId==='string'?rawOperationId.toLowerCase():rawOperationId;
  if(typeof bookingId!=='string'||!UUID_REGEX.test(bookingId))return NextResponse.json({error:'Invalid bookingId'},{status:400});
  if(typeof operationId!=='string'||!z.uuid().safeParse(operationId).success)return invalidOperation();
  const admin=createServiceRoleClient();
  const found=await admin.from('bookings').select('*, facility_profiles(name, address, phone), menu:facility_menus(name)').eq('id',bookingId).eq('user_id',user.id).maybeSingle();
  if(found.error)throw new Error('CALENDAR_BOOKING_READ_UNAVAILABLE');
  if(!found.data)return NextResponse.json({error:'Booking not found'},{status:404});
  const booking=found.data;
  // Build calendar event
  const facilityName = Array.isArray(booking.facility_profiles)
    ? booking.facility_profiles[0]?.name
    : (booking.facility_profiles as { name?: string } | null)?.name;
  const menuName = Array.isArray(booking.menu)
    ? booking.menu[0]?.name
    : (booking.menu as { name?: string } | null)?.name;

  const times = bookingCalendarTimes(booking.booking_date, booking.start_time, booking.end_time, booking.end_date ?? booking.booking_date);
  if (!times) throw new Error('CALENDAR_BOOKING_TIME_INVALID');

  const event = {
    summary: `${facilityName || '施設'} — ${menuName || '予約'}`,
    description: `CareLink 予約 #${bookingId.slice(0, 8)}\n\n予約管理: https://carelink-jp.com/mypage/bookings/${bookingId}`,
    location: (Array.isArray(booking.facility_profiles) ? booking.facility_profiles[0] : booking.facility_profiles as { address?: string } | null)?.address || '',
    start: { dateTime: times.start, timeZone: 'Asia/Tokyo' },
    end: { dateTime: times.end, timeZone: 'Asia/Tokyo' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'email', minutes: 24 * 60 },
      ],
    },
  };


  return await runCalendarOperation(admin,{operationId,userId:user.id,bookingId,kind:'sync',payload:event,credentials:()=>calendarCredentials(admin,user.id)});
 } catch {
  const response=serverError('gcal-sync',new Error('Calendar sync outcome unconfirmed'),'/api/google-calendar/sync','Internal Server Error');response.headers.set('Cache-Control','no-store');return response;
 }
}
export async function DELETE(req: NextRequest) {
 try {
  const csrfError=checkCsrf(req);if(csrfError)return csrfError;
  if(await checkRateLimit(null,getClientIp(req),20,60000,'gcal-sync-delete'))return NextResponse.json({error:'Too Many Requests'},{status:429});
  const supabase=await createServerSupabaseAuthClient();const identity=await verifyAuthUser(supabase.auth);
  if(identity.state==='unavailable')return authUnavailable('gcal-sync-delete-auth','/api/google-calendar/sync');
  if(identity.state==='unauthenticated')return NextResponse.json({error:'Unauthorized'},{status:401});
  const bookingId=req.nextUrl.searchParams.get('bookingId')?.toLowerCase();const operationId=req.nextUrl.searchParams.get('operationId')?.toLowerCase();
  if(!bookingId)return NextResponse.json({error:'bookingId required'},{status:400});
  if(!UUID_REGEX.test(bookingId))return NextResponse.json({error:'Invalid bookingId'},{status:400});
  if(!operationId||!z.uuid().safeParse(operationId).success)return invalidOperation();
  const admin=createServiceRoleClient();
  return await runCalendarOperation(admin,{operationId,userId:identity.user.id,bookingId,kind:'delete',payload:{},credentials:()=>calendarCredentials(admin,identity.user.id)});
 } catch {
  const response=serverError('gcal-sync-delete',new Error('Calendar deletion outcome unconfirmed'),'/api/google-calendar/sync','Internal Server Error');response.headers.set('Cache-Control','no-store');return response;
 }
}

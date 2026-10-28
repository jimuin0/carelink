import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { verifyAuthUser } from '@/lib/auth-verification';
import { readAuthorization } from '@/lib/authorization-read';
import { getClientIp } from '@/lib/client-ip';
import { authUnavailable, serverError, withRoute } from '@/lib/with-route';
import { UUID_REGEX } from '@/lib/constants';
import { writeAuditLog } from '@/lib/audit-logger';
import { fetchCabinetHolidays } from '@/lib/cabinet-holidays';

const dateSchema = z.iso.date().refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const bodySchema = z.object({
  allowOvernightBookings: z.boolean(),
  closeOnPublicHolidays: z.boolean(),
  closedDates: z.array(dateSchema).max(366).refine(dates => new Set(dates).size === dates.length),
  receptionCutoffMinutes: z.number().int().min(0).max(1440).nullable(),
  revision: z.iso.datetime({ offset: true }).nullable(),
}).strict();

async function identity(request: Request): Promise<{ userId: string; facilityId: string } | 'unavailable' | null> {
  const facilityId = new URL(request.url).searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;
  const client = await createServerSupabaseAuthClient();
  const verification = await verifyAuthUser(client.auth);
  if (verification.state === 'unavailable') return 'unavailable';
  if (verification.state !== 'verified') return null;
  const lookup = await readAuthorization(client.from('facility_members').select('facility_id')
    .eq('user_id', verification.user.id).eq('facility_id', facilityId).in('role', ['owner', 'admin']).maybeSingle());
  if (lookup.error) throw new Error('SPECIAL_HOURS_AUTH_UNAVAILABLE');
  return lookup.data?.facility_id === facilityId ? { userId: verification.user.id, facilityId } : null;
}

const noStore = { 'Cache-Control': 'no-store' };

export const GET = withRoute(async (request: Request) => {
  try {
    const actor = await identity(request);
    if (actor === 'unavailable') return authUnavailable('special-hours-auth', '/api/admin/special-hours');
    if (!actor) return NextResponse.json({ error: '権限を確認できません' }, { status: 401, headers: noStore });
    const result = await createServiceRoleClient().from('facility_special_hours').select('*').eq('facility_id', actor.facilityId).maybeSingle();
    if (result.error) throw new Error('SPECIAL_HOURS_READ_UNAVAILABLE');
    return NextResponse.json({
      allowOvernightBookings: result.data?.allow_overnight_bookings ?? false,
      closeOnPublicHolidays: result.data?.close_on_public_holidays ?? false,
      closedDates: result.data?.closed_dates ?? [],
      receptionCutoffMinutes: result.data?.reception_cutoff_minutes ?? null,
      revision: result.data?.updated_at ?? null,
    }, { headers: noStore });
  } catch {
    const response = serverError('special-hours-read', new Error('Special hours read unavailable'), '/api/admin/special-hours');
    response.headers.set('Cache-Control', 'no-store'); return response;
  }
}, { csrf: false, sentryTag: 'special-hours-read' });

export const PUT = withRoute(async (request: Request) => {
  try {
    const ip = getClientIp(request);
    const actor = await identity(request);
    if (actor === 'unavailable') return authUnavailable('special-hours-auth', '/api/admin/special-hours');
    if (!actor) return NextResponse.json({ error: '権限を確認できません' }, { status: 401, headers: noStore });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400, headers: noStore });
    const holidays = parsed.data.closeOnPublicHolidays ? await fetchCabinetHolidays() : null;
    if (parsed.data.closeOnPublicHolidays && !holidays)
      return NextResponse.json({ error: '祝日情報を確認できません。時間をおいて再度お試しください。' }, { status: 503, headers: noStore });
    const saved = await createServiceRoleClient().rpc('save_facility_special_hours_atomic', {
      p_actor_id: actor.userId, p_facility_id: actor.facilityId, p_allow_overnight: parsed.data.allowOvernightBookings,
      p_close_on_holidays: parsed.data.closeOnPublicHolidays, p_closed_dates: parsed.data.closedDates,
      p_cutoff_minutes: parsed.data.receptionCutoffMinutes, p_expected_updated_at: parsed.data.revision,
      p_holiday_dates: holidays ? [...holidays.dates] : null,
      p_holiday_from: holidays?.from ?? null, p_holiday_through: holidays?.through ?? null,
    });
    if (saved.error?.message.includes('SPECIAL_HOURS_CHANGED'))
      return NextResponse.json({ error: '別の画面で設定が変更されています。再読み込みして確認してください' }, { status: 409, headers: noStore });
    if (saved.error?.message.includes('FACILITY_PERMISSION_REVOKED'))
      return NextResponse.json({ error: '店舗の管理権限がありません' }, { status: 403, headers: noStore });
    if (saved.error?.message.includes('SPECIAL_HOURS_HAS_BOOKINGS'))
      return NextResponse.json({ error: '追加した休業日に予約があります。予約内容を確認してから設定してください。' }, { status: 409, headers: noStore });
    if (saved.error?.message.includes('HOLIDAY_CALENDAR_UNAVAILABLE'))
      return NextResponse.json({ error: '予約日の祝日情報を確認できません。' }, { status: 409, headers: noStore });
    if (saved.error) throw new Error('SPECIAL_HOURS_SAVE_UNCONFIRMED');
    void writeAuditLog({ userId: actor.userId, facilityId: actor.facilityId, action: 'update',
      tableName: 'facility_special_hours', recordId: actor.facilityId, ipAddress: ip });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch {
    const response = serverError('special-hours-save', new Error('Special hours save unconfirmed'), '/api/admin/special-hours');
    response.headers.set('Cache-Control', 'no-store'); return response;
  }
}, { csrf: true, rateLimit: { limiter: null, limit: 20, windowMs: 60_000, prefix: 'special-hours-save' }, sentryTag: 'special-hours-save' });

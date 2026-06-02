import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';

// ネット予約の時間帯指定 一括停止（#03/#09/#10）。指定日の停止時間帯を登録/一覧/削除する。
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const createSchema = z.object({
  suspend_date: z.string().regex(DATE_RE).refine(
    (s) => { const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; },
    '日付が不正です',
  ),
  start_time: z.string().regex(TIME_RE),
  end_time: z.string().regex(TIME_RE),
}).refine((d) => d.start_time < d.end_time, { message: '開始は終了より前にしてください', path: ['end_time'] });

async function getAdminInfo(request: NextRequest): Promise<{ facilityId: string; userId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;
  const { data } = await supabase
    .from('facility_members').select('facility_id')
    .eq('user_id', user.id).eq('facility_id', facilityId).in('role', ['owner', 'admin']).single();
  return data ? { facilityId: data.facility_id, userId: user.id } : null;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 60, 60_000, 'booking-suspension-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('facility_booking_suspensions').select('id, suspend_date, start_time, end_time')
    .eq('facility_id', auth.facilityId)
    .order('suspend_date', { ascending: true }).order('start_time', { ascending: true });
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ suspensions: data ?? [] });
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'booking-suspension-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('facility_booking_suspensions')
    .insert({ facility_id: auth.facilityId, suspend_date: parsed.data.suspend_date, start_time: parsed.data.start_time, end_time: parsed.data.end_time, created_by: auth.userId })
    .select('id, suspend_date, start_time, end_time').single();
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({ userId: auth.userId, facilityId: auth.facilityId, action: 'create', tableName: 'facility_booking_suspensions', recordId: data.id, ipAddress: ip });
  return NextResponse.json({ suspension: data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'booking-suspension-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = request.nextUrl.searchParams.get('id');
  if (!id || !UUID_REGEX.test(id)) return NextResponse.json({ error: 'id が不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  // facility_id を WHERE に含め他施設の停止枠を削除できないようにする（IDOR防御）
  const { error } = await admin
    .from('facility_booking_suspensions').delete().eq('id', id).eq('facility_id', auth.facilityId);
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({ userId: auth.userId, facilityId: auth.facilityId, action: 'delete', tableName: 'facility_booking_suspensions', recordId: id, ipAddress: ip });
  return NextResponse.json({ ok: true });
}

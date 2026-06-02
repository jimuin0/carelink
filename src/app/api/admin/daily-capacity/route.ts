import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';

// サロンの受付可能枠数（日別 #05/#46）。指定日の上限を一覧/設定/解除する。
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const putSchema = z.object({
  capacity_date: z.string().regex(DATE_RE).refine(
    (s) => { const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; },
    '日付が不正です',
  ),
  max_bookings: z.number().int().min(0).max(999),
});

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
  if (inMemoryRateLimit(ip, 60, 60_000, 'daily-capacity-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // from/to（YYYY-MM-DD）で月などの範囲に絞れる（任意）
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');
  const admin = createServiceRoleClient();
  let q = admin.from('facility_daily_capacity').select('capacity_date, max_bookings').eq('facility_id', auth.facilityId);
  if (from && DATE_RE.test(from)) q = q.gte('capacity_date', from);
  if (to && DATE_RE.test(to)) q = q.lte('capacity_date', to);
  const { data, error } = await q.order('capacity_date', { ascending: true });
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ capacities: data ?? [] });
}

export async function PUT(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 60, 60_000, 'daily-capacity-put')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('facility_daily_capacity')
    .upsert({ facility_id: auth.facilityId, capacity_date: parsed.data.capacity_date, max_bookings: parsed.data.max_bookings, created_by: auth.userId, updated_at: new Date().toISOString() }, { onConflict: 'facility_id,capacity_date' })
    .select('capacity_date, max_bookings').single();
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({ userId: auth.userId, facilityId: auth.facilityId, action: 'update', tableName: 'facility_daily_capacity', recordId: parsed.data.capacity_date, ipAddress: ip });
  return NextResponse.json({ capacity: data });
}

export async function DELETE(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 60, 60_000, 'daily-capacity-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dateParam = request.nextUrl.searchParams.get('date');
  if (!dateParam || !DATE_RE.test(dateParam)) return NextResponse.json({ error: 'date が不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from('facility_daily_capacity').delete().eq('facility_id', auth.facilityId).eq('capacity_date', dateParam);
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({ userId: auth.userId, facilityId: auth.facilityId, action: 'delete', tableName: 'facility_daily_capacity', recordId: dateParam, ipAddress: ip });
  return NextResponse.json({ ok: true });
}

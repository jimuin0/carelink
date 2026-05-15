import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';

const treatmentPlanSchema = z.object({
  user_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(100),
  diagnosis: z.string().max(200).optional().nullable(),
  goal: z.string().max(200).optional().nullable(),
  total_sessions: z.number().int().min(1).max(9999),
  frequency: z.string().max(50).optional().nullable(),
  duration_weeks: z.number().int().min(1).max(520).optional().nullable(),
  started_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

async function getAdminInfo(request: NextRequest): Promise<{ facilityId: string; userId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;

  const { data } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();

  return data ? { facilityId: data.facility_id, userId: user.id } : null;
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-treatment-plans-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = treatmentPlanSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();

  // user_id が指定された場合、その施設に予約があるユーザーのみ許可（IDOR 防止）
  if (parsed.data.user_id) {
    const { data: booking } = await admin
      .from('bookings')
      .select('id')
      .eq('facility_id', auth.facilityId)
      .eq('user_id', parsed.data.user_id)
      .limit(1)
      .maybeSingle();
    if (!booking) return NextResponse.json({ error: 'このユーザーはこの施設に予約がありません' }, { status: 403 });
  }

  const { data, error } = await admin.from('treatment_plans').insert({
    facility_id: auth.facilityId,
    user_id: parsed.data.user_id ?? null,
    title: parsed.data.title,
    diagnosis: parsed.data.diagnosis ?? null,
    goal: parsed.data.goal ?? null,
    total_sessions: parsed.data.total_sessions,
    frequency: parsed.data.frequency ?? null,
    duration_weeks: parsed.data.duration_weeks ?? null,
    started_at: parsed.data.started_at ?? null,
    notes: parsed.data.notes ?? null,
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'create',
    tableName: 'treatment_plans',
    recordId: data.id,
    newValues: { title: parsed.data.title, user_id: parsed.data.user_id ?? null, total_sessions: parsed.data.total_sessions },
    ipAddress: ip,
  });

  return NextResponse.json({ plan: data }, { status: 201 });
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

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

async function getAdminFacilityId(request: NextRequest): Promise<string | null> {
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

  return data?.facility_id ?? null;
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-treatment-plans-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = treatmentPlanSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('treatment_plans').insert({
    facility_id: facilityId,
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
  return NextResponse.json({ plan: data }, { status: 201 });
}

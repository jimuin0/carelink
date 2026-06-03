import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { revalidateFacilityById } from '@/lib/revalidate';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { isMissingColumnError, omitKeys, warnMissingColumnFallback } from '@/lib/db-fallback';

const staffSchema = z.object({
  name: z.string().min(1).max(50),
  position: z.string().max(50).optional().nullable(),
  bio: z.string().max(500).optional().nullable(),
  specialties: z.array(z.string().max(50)).max(20).optional(),
  years_experience: z.number().int().min(0).max(99).optional().nullable(),
  instagram_url: z.string().url().max(200).optional().nullable().or(z.literal('')),
  nomination_fee: z.number().int().min(0).max(99999).optional(),
  line_works_channel_id: z.string().max(50).optional().nullable(),
  line_works_notify_all: z.boolean().optional(),
});

async function getAdminInfo(request: NextRequest): Promise<{ userId: string; facilityId: string } | null> {
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

  return data ? { userId: user.id, facilityId: data.facility_id } : null;
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-staff-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = staffSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  // slug は NOT NULL・UNIQUE(facility_id, slug)。氏名は日本語のため一意な ASCII slug を自動生成。
  const slug = `staff-${globalThis.crypto.randomUUID()}`;
  const insertRow = {
    facility_id: auth.facilityId,
    slug,
    name: parsed.data.name,
    position: parsed.data.position ?? null,
    bio: parsed.data.bio ?? null,
    specialties: parsed.data.specialties ?? [],
    years_experience: parsed.data.years_experience ?? null,
    instagram_url: parsed.data.instagram_url || null,
    nomination_fee: parsed.data.nomination_fee ?? 0,
    line_works_channel_id: parsed.data.line_works_channel_id ?? null,
    line_works_notify_all: parsed.data.line_works_notify_all ?? false,
    is_active: true,
  };
  // line_works_* カラム未適用(20260417マイグレーション未実行)環境でも500にしないフォールバック
  let { data, error } = await admin.from('staff_profiles').insert(insertRow).select().single();
  if (isMissingColumnError(error)) {
    warnMissingColumnFallback('staff_profiles.insert');
    ({ data, error } = await admin.from('staff_profiles').insert(omitKeys(insertRow, ['line_works_channel_id', 'line_works_notify_all'])).select().single());
  }

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'create',
    tableName: 'staff_profiles',
    recordId: data.id,
    newValues: { name: parsed.data.name, position: parsed.data.position ?? null, nomination_fee: parsed.data.nomination_fee ?? 0 },
    ipAddress: ip,
    userAgent: ua,
  });
  await revalidateFacilityById(auth.facilityId); // ISR再検証(round6)
  return NextResponse.json({ staff: data }, { status: 201 });
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

const catalogSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  price: z.number().int().min(0).max(9999999).optional().nullable(),
  duration_minutes: z.number().int().min(0).max(1440).optional().nullable(),
  is_published: z.boolean().optional(),
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

  const ip = getClientIp(request);
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-catalog-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = catalogSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('treatment_catalogs').insert({
    facility_id: auth.facilityId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    category: parsed.data.category ?? null,
    price: parsed.data.price ?? null,
    duration_minutes: parsed.data.duration_minutes ?? null,
    is_published: parsed.data.is_published ?? false,
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ip: auditIp, ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'create',
    tableName: 'treatment_catalogs',
    recordId: data.id,
    newValues: { name: parsed.data.name, is_published: parsed.data.is_published ?? false },
    ipAddress: auditIp,
    userAgent: ua,
  });

  return NextResponse.json({ item: data }, { status: 201 });
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

const menuSchema = z.object({
  category: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  price: z.number().int().min(0).max(9999999).optional().nullable(),
  price_note: z.string().max(100).optional().nullable(),
  duration_minutes: z.number().int().min(0).max(1440).optional().nullable(),
  photo_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  is_featured: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
});

async function getAdminContext(request: NextRequest): Promise<{ userId: string; facilityId: string } | null> {
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

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'menus-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminContext(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { facilityId } = auth;

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('facility_menus')
    .select('*')
    .eq('facility_id', facilityId)
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ menus: data });
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-menus-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminContext(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { userId, facilityId } = auth;

  const body = await request.json().catch(() => null);
  const parsed = menuSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();

  // Duplicate name check
  const { data: existing } = await admin
    .from('facility_menus')
    .select('id')
    .eq('facility_id', facilityId)
    .eq('name', parsed.data.name)
    .maybeSingle();
  if (existing) return NextResponse.json({ error: '同じ名前のメニューが既に存在します' }, { status: 409 });

  // Count for sort_order default
  const { count } = await admin
    .from('facility_menus')
    .select('id', { count: 'exact', head: true })
    .eq('facility_id', facilityId);

  const { data, error } = await admin.from('facility_menus').insert({
    facility_id: facilityId,
    ...parsed.data,
    photo_url: parsed.data.photo_url || null,
    sort_order: parsed.data.sort_order ?? (count ?? 0),
    // facility_menus に updated_at 列は存在しない（created_at のみ）。書き込むと 400 になるため付けない。
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId,
    facilityId,
    action: 'create',
    tableName: 'facility_menus',
    recordId: data.id,
    newValues: { name: parsed.data.name, category: parsed.data.category, price: parsed.data.price },
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ menu: data }, { status: 201 });
}

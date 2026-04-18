import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

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

async function getAdminFacilityId(request: NextRequest): Promise<string | null> {
  const supabase = createServerSupabaseAuthClient();
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

export async function GET(request: NextRequest) {
  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-menus-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
    updated_at: new Date().toISOString(),
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ menu: data }, { status: 201 });
}

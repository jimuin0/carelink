import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

const packageSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  menu_id: z.string().uuid().nullable().optional(),
  session_count: z.number().int().min(1).max(100),
  bonus_count: z.number().int().min(0).max(50),
  price: z.number().int().min(0),
  valid_days: z.number().int().min(1).max(3650),
  notes: z.string().max(500).optional(),
  is_active: z.boolean().optional(),
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

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'packages-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  const { data, error } = await admin
    .from('service_packages')
    .select('*, menus:facility_menus(name)')
    .eq('facility_id', facilityId)
    .order('sort_order')
    .order('created_at');

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ packages: data });
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'packages')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = packageSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();

  // menu_id を指定する場合は、自施設の facility_menus に属することを検証する
  // （他施設の menu_id を関連付ける越境参照を防止）
  if (parsed.data.menu_id) {
    const { data: menu } = await admin
      .from('facility_menus')
      .select('id')
      .eq('id', parsed.data.menu_id)
      .eq('facility_id', facilityId)
      .single();
    if (!menu) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const { data, error } = await admin.from('service_packages').insert({
    facility_id: facilityId,
    ...parsed.data,
    is_active: parsed.data.is_active ?? true,
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ package: data }, { status: 201 });
}

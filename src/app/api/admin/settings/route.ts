import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const businessHoursDaySchema = z.union([
  z.object({ open: z.string().regex(TIME_REGEX), close: z.string().regex(TIME_REGEX) }),
  z.null(),
]);

const settingsSchema = z.object({
  name: z.string().min(1).max(100),
  business_type: z.string().max(50).optional().nullable(),
  catch_copy: z.string().max(200).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  postal_code: z.string().max(8).optional().nullable(),
  prefecture: z.string().max(20).optional().nullable(),
  city: z.string().max(50).optional().nullable(),
  address: z.string().max(100).optional().nullable(),
  building: z.string().max(100).optional().nullable(),
  access_info: z.string().max(200).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  website_url: z.string().url().max(200).optional().nullable().or(z.literal('')),
  seat_count: z.number().int().min(0).max(9999).optional().nullable(),
  staff_count: z.number().int().min(0).max(9999).optional().nullable(),
  parking: z.boolean().optional(),
  credit_card: z.boolean().optional(),
  features: z.array(z.string().max(50)).max(50).optional(),
  regular_holiday: z.string().max(100).optional().nullable(),
  business_hours: z.record(z.string(), businessHoursDaySchema).optional().nullable(),
  booking_auto_confirm: z.boolean().optional(),
  booking_buffer_minutes: z.number().int().min(0).max(120).optional(),
});

const statusSchema = z.object({
  status: z.enum(['draft', 'published', 'suspended']),
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

// PATCH: Update facility settings
export async function PATCH(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-settings-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);

  // Check if this is a status-only update
  const action = request.nextUrl.searchParams.get('action');
  if (action === 'status') {
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

    const admin = createServiceRoleClient();
    const { error } = await admin
      .from('facility_profiles')
      .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
      .eq('id', facilityId);

    if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  // Validate business hours consistency
  if (parsed.data.business_hours) {
    for (const [day, hours] of Object.entries(parsed.data.business_hours)) {
      if (hours && hours.close <= hours.open) {
        return NextResponse.json({ error: `${day}の閉店時間は開店時間より後にしてください` }, { status: 400 });
      }
    }
  }

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from('facility_profiles')
    .update({
      ...parsed.data,
      website_url: parsed.data.website_url || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', facilityId);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

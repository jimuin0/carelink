import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

const paymentsSettingsSchema = z.object({
  deposit_type: z.enum(['none', 'fixed', 'percent']),
  deposit_amount: z.number().int().min(0).max(9999999),
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

export async function PATCH(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-payments-settings-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = paymentsSettingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  // Additional validation: percent must be 1-100
  if (parsed.data.deposit_type === 'percent' && (parsed.data.deposit_amount < 1 || parsed.data.deposit_amount > 100)) {
    return NextResponse.json({ error: 'デポジット率は1〜100%で指定してください' }, { status: 400 });
  }
  // Fixed must be at least 100 yen
  if (parsed.data.deposit_type === 'fixed' && parsed.data.deposit_amount < 100) {
    return NextResponse.json({ error: 'デポジット金額は100円以上で指定してください' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from('facility_profiles')
    .update({
      deposit_amount: parsed.data.deposit_amount,
      deposit_type: parsed.data.deposit_type,
      updated_at: new Date().toISOString(),
    })
    .eq('id', facilityId);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

const paymentsSettingsSchema = z.object({
  deposit_type: z.enum(['none', 'fixed', 'percent']),
  deposit_amount: z.number().int().min(0).max(9999999),
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

export async function PATCH(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-payments-settings-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = paymentsSettingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.deposit_type === 'percent' && (parsed.data.deposit_amount < 1 || parsed.data.deposit_amount > 100)) {
    return NextResponse.json({ error: 'デポジット率は1〜100%で指定してください' }, { status: 400 });
  }
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
    .eq('id', auth.facilityId);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'update',
    tableName: 'facility_profiles',
    recordId: auth.facilityId,
    newValues: { deposit_type: parsed.data.deposit_type, deposit_amount: parsed.data.deposit_amount },
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true });
}

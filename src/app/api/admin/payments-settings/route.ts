import { NextRequest, NextResponse } from 'next/server';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { serverError } from '@/lib/with-route';

const paymentsSettingsSchema = z.object({
  deposit_type: z.enum(['none', 'fixed', 'percent']),
  deposit_amount: z.number().int().min(0).max(9999999),
});

export async function PATCH(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-payments-settings-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  // 認証基盤・DB の障害を 401 に化けさせない（503 で返す）共通の判定を使う。
  const auth = await getAdminApiContext(request);
  if (auth instanceof NextResponse) return auth;

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

  if (error) return serverError('admin-payments-settings-patch', error, '/api/admin/payments-settings');

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

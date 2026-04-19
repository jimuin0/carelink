/**
 * 施設認証バッジ管理 API（v8.32）
 * PATCH /api/admin/facility-verify
 * プラットフォーム管理者のみ: 施設の認証ステータスを付与・取り消し
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { UUID_REGEX } from '@/lib/constants';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

async function getPlatformAdminUser(): Promise<string | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();

  return profile?.is_platform_admin ? user.id : null;
}

export async function PATCH(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'facility-verify')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const userId = await getPlatformAdminUser();
  if (!userId) return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { facility_id, is_verified, verified_type } = body;

  if (!facility_id || !UUID_REGEX.test(facility_id)) {
    return NextResponse.json({ error: 'facility_id が不正です' }, { status: 400 });
  }

  const validTypes = ['phone', 'identity', 'site_visit'];
  if (is_verified && verified_type && !validTypes.includes(verified_type)) {
    return NextResponse.json({ error: '無効な verified_type です' }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {
    is_verified: Boolean(is_verified),
  };

  if (is_verified) {
    updateData.verified_type = verified_type || 'phone';
    updateData.verified_at = new Date().toISOString();
  } else {
    updateData.verified_type = null;
    updateData.verified_at = null;
  }

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from('facility_profiles')
    .update(updateData)
    .eq('id', facility_id);

  if (error) {
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
  }

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId,
    facilityId: facility_id,
    action: is_verified ? 'verify' : 'update',
    tableName: 'facility_profiles',
    recordId: facility_id,
    newValues: { is_verified: Boolean(is_verified), verified_type: updateData.verified_type ?? null },
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({
    success: true,
    facility_id,
    is_verified: Boolean(is_verified),
    verified_type: is_verified ? (verified_type || 'phone') : null,
  });
}

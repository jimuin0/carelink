/**
 * 施設認証バッジ管理 API（v8.31）
 * PATCH /api/admin/facility-verify
 * プラットフォーム管理者のみ: 施設の認証ステータスを付与・取り消し
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { UUID_REGEX } from '@/lib/constants';
import { inMemoryRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'facility-verify')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  // 管理者権限チェック
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
  }

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

  const { error } = await supabase
    .from('facility_profiles')
    .update(updateData)
    .eq('id', facility_id);

  if (error) {
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    facility_id,
    is_verified: Boolean(is_verified),
    verified_type: is_verified ? (verified_type || 'phone') : null,
  });
}

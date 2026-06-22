import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

const flagUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  rollout_pct: z.number().int().min(0).max(100).optional(),
});

async function getAdminUser(): Promise<string | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Feature flags are platform-wide — require platform admin only
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();

  return profile?.is_platform_admin ? user.id : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-feature-flags-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const userId = await getAdminUser();
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = flagUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('feature_flags')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    // 0件一致（存在しないID）は PostgREST が PGRST116 を返す → 404 で返す。
    if ((error as { code?: string }).code === 'PGRST116') {
      return NextResponse.json({ error: 'フラグが見つかりません' }, { status: 404 });
    }
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
  // .single() は0件一致時に必ず PGRST116 エラー（上で処理済み）を返すため、error=null かつ
  // data=null は到達不能。万一の supabase 実装差異に備える防御的フォールバック。
  /* istanbul ignore next -- 到達不能な防御コード（.single() は data か PGRST116 のいずれかを返す） */
  if (!data) return NextResponse.json({ error: 'フラグが見つかりません' }, { status: 404 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId,
    action: 'update',
    tableName: 'feature_flags',
    recordId: params.id,
    newValues: parsed.data,
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true });
}

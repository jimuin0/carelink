/**
 * Feature Flags 一覧 API
 * GET /api/admin/feature-flags
 * プラットフォーム管理者のみ
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

async function getAdminUser(): Promise<string | null> {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();

  return profile?.is_platform_admin ? user.id : null;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'admin-feature-flags-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const userId = await getAdminUser();
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { ab } = Object.fromEntries(request.nextUrl.searchParams);

  const admin = createServiceRoleClient();
  let query = admin
    .from('feature_flags')
    .select('id, key, enabled, rollout_pct, description, updated_at')
    .order('key');

  // A/Bテスト用: ロールアウト中のフラグのみ
  if (ab === '1') {
    query = query.gt('rollout_pct', 0).lt('rollout_pct', 100).eq('enabled', true);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ flags: data ?? [] });
}

const flagCreateSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, 'キーは小文字英数字・アンダースコア・ハイフンのみ'),
  enabled: z.boolean().optional(),
  rollout_pct: z.number().int().min(0).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'admin-feature-flags-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const userId = await getAdminUser();
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = flagCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('feature_flags')
    .insert({
      key: parsed.data.key,
      enabled: parsed.data.enabled ?? false,
      rollout_pct: parsed.data.rollout_pct ?? 0,
      description: parsed.data.description ?? null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'そのキーはすでに存在します' }, { status: 409 });
    }
    return NextResponse.json({ error: '作成に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ flag: data }, { status: 201 });
}

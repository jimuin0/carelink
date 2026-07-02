import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

const profileSchema = z.object({
  display_name: z.string().min(1, 'お名前は必須です').max(50),
  phone: z.string().max(20).nullable().optional(),
  prefecture: z.string().max(20).nullable().optional(),
  city: z.string().max(50).nullable().optional(),
  birth_date: z.string().max(10).nullable().optional(),
  gender: z.enum(['male', 'female', 'other', 'unspecified']).nullable().optional(),
});

// LINE 連携状態を返す（mypage/settings が連携バッジ表示に使用）。
// 旧実装は GET ハンドラが無く settings が GET /api/profile → 405 → 常にエラー表示していた。
// 連携は profiles.line_user_id ではなく line_user_links テーブルで管理される（mypage/profile と同経路）。
export const GET = withRoute(async (_request, ctx) => {
  const serviceClient = createServiceRoleClient();
  const { data, error } = await serviceClient
    .from('line_user_links')
    .select('user_id')
    .eq('user_id', ctx.user!.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ linked: !!data });
}, {
  csrf: false,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 30, windowMs: 60_000, prefix: 'profile-get' },
  sentryTag: 'profile-get',
});

export const PUT = withRoute(async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const d = parsed.data;
  const serviceClient = createServiceRoleClient();
  const { error } = await serviceClient
    .from('profiles')
    .update({
      display_name: d.display_name,
      phone: d.phone ?? null,
      prefecture: d.prefecture ?? null,
      city: d.city ?? null,
      birth_date: d.birth_date ?? null,
      gender: d.gender ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ctx.user!.id);

  if (error) {
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}, {
  csrf: true,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 10, windowMs: 60_000, prefix: 'profile' },
  sentryTag: 'profile',
});

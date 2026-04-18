import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

const featureArticleSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(300).optional().nullable(),
  image_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  href: z.string().max(300).optional().nullable(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});


/**
 * feature_articles はサイト全体の特集記事（facility_id を持たない）。
 * 書き込み操作は SUPER_ADMIN_USER_IDS に列挙されたユーザーのみに限定する。
 * 環境変数未設定時はすべての書き込みを拒否する（フェイルセーフ）。
 */
function getSuperAdminIds(): Set<string> {
  const raw = process.env.SUPER_ADMIN_USER_IDS ?? '';
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getAdminUser(_request: NextRequest): Promise<string | null> {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // feature_articles はサイトワイドコンテンツ — スーパーアドミンのみ編集可
  const superAdminIds = getSuperAdminIds();
  if (!superAdminIds.has(user.id)) return null;

  return user.id;
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-features-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const userId = await getAdminUser(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = featureArticleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('feature_articles').insert({
    title: parsed.data.title,
    subtitle: parsed.data.subtitle ?? null,
    image_url: parsed.data.image_url || null,
    href: parsed.data.href ?? null,
    is_active: parsed.data.is_active ?? true,
    sort_order: parsed.data.sort_order ?? 0,
    updated_at: new Date().toISOString(),
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ feature: data }, { status: 201 });
}

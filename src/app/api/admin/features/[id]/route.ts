import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

const featureUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
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
async function getAdminUser(request: NextRequest): Promise<string | null> {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // feature_articles はサイトワイドコンテンツ — スーパーアドミンのみ編集可
  const superAdminIds = getSuperAdminIds();
  if (!superAdminIds.has(user.id)) return null;

  return user.id;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-features-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const userId = await getAdminUser(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = featureUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('feature_articles')
    .update({ ...parsed.data, image_url: parsed.data.image_url || null, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
  return NextResponse.json({ feature: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-features-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const userId = await getAdminUser(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from('feature_articles').delete().eq('id', params.id);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

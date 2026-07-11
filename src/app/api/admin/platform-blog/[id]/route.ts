import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';

const platformBlogUpdateSchema = z.object({
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/, 'スラッグは半角英数字とハイフンのみ使用できます').optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  reading_time: z.number().int().min(1).max(999).optional(),
  content: z.array(z.record(z.string(), z.unknown())).optional(),
  is_published: z.boolean().optional(),
});

async function getAdminUser(): Promise<string | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Platform blog is site-wide content — require platform admin only
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
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-platform-blog-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const userId = await getAdminUser();
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = platformBlogUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const updatePayload: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.is_published !== undefined) {
    updatePayload.published_at = parsed.data.is_published ? new Date().toISOString() : null;
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('platform_blog_posts')
    .update(updatePayload)
    .eq('id', params.id)
    .select()
    // .maybeSingle(): 該当0行（存在しないid）を not found として扱う。.single() だと0行→PGRST116で
    // 下の if(error)→500 が先に発火し if(!data)→404 が到達不能になる（404がデッドコード・500に化ける）。
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId,
    action: 'update',
    tableName: 'platform_blog_posts',
    recordId: params.id,
    newValues: updatePayload,
    ipAddress: ip,
  });

  return NextResponse.json({ post: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-platform-blog-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const userId = await getAdminUser();
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceRoleClient();
  // 【2026年7月10日 恒久根治】削除件数を検証せず常に成功を返していたため、存在しないIDの
  // 削除試行（0件削除）も「成功」と偽装していた（phantom success）。.select() で削除された
  // 行を受け取り、0件なら404を返す。
  const { data, error } = await admin
    .from('platform_blog_posts')
    .delete()
    .eq('id', params.id)
    .select();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId,
    action: 'delete',
    tableName: 'platform_blog_posts',
    recordId: params.id,
    ipAddress: ip,
  });

  return NextResponse.json({ ok: true });
}

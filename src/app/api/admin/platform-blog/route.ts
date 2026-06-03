import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

const platformBlogSchema = z.object({
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/, 'スラッグは半角英数字とハイフンのみ使用できます'),
  title: z.string().min(1).max(200),
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

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-platform-blog-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const userId = await getAdminUser();
  if (!userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = platformBlogSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const isPublished = parsed.data.is_published ?? false;
  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('platform_blog_posts').insert({
    slug: parsed.data.slug,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    category: parsed.data.category ?? null,
    tags: parsed.data.tags ?? [],
    reading_time: parsed.data.reading_time ?? 5,
    content: parsed.data.content ?? [],
    is_published: isPublished,
    published_at: isPublished ? new Date().toISOString() : null,
  }).select().single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ post: data }, { status: 201 });
}

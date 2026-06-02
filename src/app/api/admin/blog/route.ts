import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { isMissingColumnError, omitKeys, warnMissingColumnFallback } from '@/lib/db-fallback';

const blogPostSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50000),
  is_published: z.boolean().optional(),
  coupon_id: z.string().uuid().optional().nullable(),
  author_id: z.string().uuid().optional().nullable(),
  thumbnail_url: z.string().max(200000).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
});

async function getAdminInfo(request: NextRequest): Promise<{ facilityId: string; userId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;

  const { data } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();

  return data ? { facilityId: data.facility_id, userId: user.id } : null;
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-blog-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = blogPostSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const isPublished = parsed.data.is_published ?? false;
  const admin = createServiceRoleClient();
  // slug は NOT NULL・UNIQUE(facility_id, slug)。タイトルは日本語のため一意な ASCII slug を自動生成。
  const slug = `post-${globalThis.crypto.randomUUID()}`;
  const insertRow = {
    facility_id: auth.facilityId,
    title: parsed.data.title,
    content: parsed.data.content,
    slug,
    coupon_id: parsed.data.coupon_id ?? null,
    author_id: parsed.data.author_id ?? null,
    thumbnail_url: parsed.data.thumbnail_url ?? null,
    category: parsed.data.category ?? null,
    is_published: isPublished,
    published_at: isPublished ? new Date().toISOString() : null,
  };
  let { data, error } = await admin.from('blog_posts').insert(insertRow).select().single();
  if (isMissingColumnError(error)) {
    warnMissingColumnFallback('blog_posts.insert');
    ({ data, error } = await admin.from('blog_posts').insert(omitKeys(insertRow, ['category'])).select().single());
  }

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ip: auditIp, ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'create',
    tableName: 'blog_posts',
    recordId: data.id,
    newValues: { title: parsed.data.title, is_published: isPublished },
    ipAddress: auditIp,
    userAgent: ua,
  });

  return NextResponse.json({ post: data }, { status: 201 });
}

import { NextRequest, NextResponse } from 'next/server';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { manageAdminContent } from '@/lib/admin-content-write';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

const blogPostSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50000),
  is_published: z.boolean().optional(),
});

// blog_posts.slug は NOT NULL かつ UNIQUE(facility_id, slug)。従来 insert で slug を設定して
// いなかったため NOT NULL 違反で作成が常に 500 失敗していた（オーナーのブログ作成が全滅）。
// タイトルを ASCII slug 化し（日本語等は除去）、衝突回避の乱数トークンを付与して一意な slug を生成する。
function generateBlogSlug(title: string): string {
  const base = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  return base ? `${base}-${token}` : `post-${token}`;
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-blog-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminApiContext(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = blogPostSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const isPublished = parsed.data.is_published ?? false;
  const data = await manageAdminContent({actorId:auth.userId,facilityId:auth.facilityId,recordId:null,kind:'blog:create',values:{
    title:parsed.data.title,slug:generateBlogSlug(parsed.data.title),content:parsed.data.content,is_published:isPublished,
  }});
  if (data instanceof NextResponse) return data;

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

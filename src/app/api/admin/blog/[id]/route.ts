import { NextRequest, NextResponse } from 'next/server';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { manageAdminContent } from '@/lib/admin-content-write';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import type { Database } from '@/types/database.types';

// blog_posts の update() に渡すオブジェクトの型。
// Record<string, unknown> は Database 型配線後の update() が要求する
// 「宣言外キー拒否」の型と両立しない（インデックスシグネチャ型は余剰プロパティ無しを保証できない）。
// テーブルの Update 型そのものを使い、意味を変えずに型検査を通す。
type BlogPostUpdate = Database['public']['Tables']['blog_posts']['Update'];

const blogUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(50000).optional(),
  is_published: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-blog-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const auth = await getAdminApiContext(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = blogUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const updatePayload: BlogPostUpdate = { ...parsed.data };
  const data = await manageAdminContent({actorId:auth.userId,facilityId:auth.facilityId,recordId:params.id,kind:'blog:update',values:updatePayload});
  if (data instanceof NextResponse) return data;

  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'update',
    tableName: 'blog_posts',
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
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-blog-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const auth = await getAdminApiContext(request);
  if (auth instanceof NextResponse) return auth;

  const data = await manageAdminContent({actorId:auth.userId,facilityId:auth.facilityId,recordId:params.id,kind:'blog:delete',values:{}});
  if (data instanceof NextResponse) return data;

  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'delete',
    tableName: 'blog_posts',
    recordId: params.id,
    ipAddress: ip,
  });

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import type { Json } from '@/types/database.types';
import { serverError } from '@/lib/with-route';

const platformBlogSchema = z.object({
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/, 'スラッグは半角英数字とハイフンのみ使用できます'),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  reading_time: z.number().int().min(1).max(999).optional(),
  // platform_blog_posts.content は jsonb 列（Database 型では Json）。z.unknown() だと値の型が
  // unknown になり Json（string|number|boolean|null|Json[]|{[k:string]:Json|undefined}）に
  // 代入できず tsc エラーになる。z.custom<Json>() はデフォルトで常に許可（実行時バリデーションは
  // 従来どおり無し）のまま出力型だけを Json に合わせるため、実行時の受け入れ範囲は変えていない。
  content: z.array(z.record(z.string(), z.custom<Json>())).optional(),
  is_published: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-platform-blog-post')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const adminUser = await requirePlatformAdmin();
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const userId = adminUser.id;

  const body = await request.json().catch(() => null);
  const parsed = platformBlogSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const isPublished = parsed.data.is_published ?? false;
  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('platform_blog_posts').insert({
    slug: parsed.data.slug,
    title: parsed.data.title,
    // description/category は migration(20260417000025)上 NOT NULL DEFAULT ''。
    // 従来は未指定・明示nullのどちらでも description: null を INSERT していたため、
    // NOT NULL 制約違反で常に DB エラー（500）になっていた実バグ。null/未指定は
    // 「値なし」として key ごと省略し、列の DEFAULT ''（空文字）に委ねるよう修正する。
    description: parsed.data.description ?? undefined,
    category: parsed.data.category ?? undefined,
    tags: parsed.data.tags ?? [],
    reading_time: parsed.data.reading_time ?? 5,
    content: parsed.data.content ?? [],
    is_published: isPublished,
    published_at: isPublished ? new Date().toISOString() : null,
  }).select().single();

  if (error) return serverError('admin-platform-blog-create', error, '/api/admin/platform-blog');

  void writeAuditLog({
    userId,
    action: 'create',
    tableName: 'platform_blog_posts',
    recordId: data.id,
    newValues: { slug: data.slug, title: data.title, is_published: data.is_published },
    ipAddress: ip,
  });

  return NextResponse.json({ post: data }, { status: 201 });
}

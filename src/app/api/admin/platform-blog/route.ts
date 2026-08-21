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
import { runAfterResponse } from '@/lib/after-response';
import { publishArticleToThreads } from '@/lib/platform-blog-threads';

/**
 * 記事公開を Threads 投稿のきっかけに配線する処理本体。
 *
 * 🔴 [id]/route.ts の PATCH にも同一実装が存在する（意図的な重複）。src/lib/ は本タスクでは
 * 他エージェントの担当領域のため、共有ヘルパーを新設せずこの2ファイルにそれぞれ閉じ込める
 * （CLAUDE.md「route.ts は HTTP メソッド以外を export できない」により route.ts 自体には
 * 置けないので、各ファイル内の非 export ローカル関数として複製する）。統合するかどうかは
 * 親（司令塔）が両担当の変更を合流させた後に判断する。
 *
 * 【claim を投稿の"前"に立てる理由】
 * 記事は何度も編集保存され、公開トグルも往復しうる。「投稿されたのに記録が残らない」より
 * 「同じ記事が Threads に複数回流れる」方が公式アカウントの信頼性を直接損なうため、
 * 二重投稿を確実に防ぐ側へ倒す。よって「投稿してから記録する」（投稿が先＝その間に来た
 * 並行リクエストが再度投稿できてしまう）ではなく、「投稿する前に claim を立てる」
 * （claim 成功を投稿の必要条件にする）を採用する。
 *
 * claim の鍵は `threads_posted_at` 自身（onboarding-followup cron の
 * `.is('onboarding_email_sent_at', null)` と同型の CAS）。同時に `threads_post_id IS NULL` も
 * 必須条件にし、「一度でも投稿に成功した記事」を鍵の状態に関わらず永久に除外する
 * （公開取り消し→再公開での再投稿防止・要件3）。
 */

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

  // 公開された新規記事だけ Threads へ配線する。claim（threads_posted_at）と成功記録
  // （threads_post_id）は publishArticleToThreads 内の CAS が一元管理するため、ここでは
  // 「公開されているかどうか」だけを見て呼び出すだけでよい（新規作成なので post_id は必ず null）。
  if (data.is_published) {
    runAfterResponse(() => publishArticleToThreads(admin, { id: data.id, slug: data.slug, title: data.title }, '/api/admin/platform-blog'));
  }

  return NextResponse.json({ post: data }, { status: 201 });
}

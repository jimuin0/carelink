import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX, SITE_URL } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import type { Database, Json } from '@/types/database.types';
import { serverError } from '@/lib/with-route';
import { runAfterResponse } from '@/lib/after-response';
import { alertWarning } from '@/lib/alert';
import { publishThreadsText, buildArticlePostText } from '@/lib/threads';

/**
 * 記事公開を Threads 投稿のきっかけに配線する処理本体。
 *
 * 🔴 route.ts（POST）にも同一実装が存在する（意図的な重複）。src/lib/ は本タスクでは
 * 他エージェントの担当領域のため、共有ヘルパーを新設せずこの2ファイルにそれぞれ閉じ込める
 * （route.ts は HTTP メソッド以外を export できないため各ファイル内の非 export ローカル関数として
 * 複製する）。統合するかどうかは親（司令塔）が両担当の変更を合流させた後に判断する。
 *
 * 【claim を投稿の"前"に立てる理由】route.ts 側のコメントと同一（「投稿されたのに記録が
 * 残らない」より「二重投稿」の方が公式アカウントの信頼性を損なう度合いが大きいため、
 * claim 成功を投稿の必要条件にする）。
 *
 * claim の鍵は `threads_posted_at` 自身（onboarding-followup cron の CAS と同型）。
 * `threads_post_id IS NULL` も必須条件にし、一度でも投稿に成功した記事は claim の状態に
 * 関わらず永久に除外する（公開取り消し→再公開での再投稿防止・要件3）。
 */
async function publishArticleToThreads(
  admin: ReturnType<typeof createServiceRoleClient>,
  post: { id: string; slug: string; title: string }
): Promise<void> {
  const nowIso = new Date().toISOString();

  const { data: claimed, error: claimError } = await admin
    .from('platform_blog_posts')
    .update({ threads_posted_at: nowIso })
    .eq('id', post.id)
    .is('threads_post_id', null)
    .is('threads_posted_at', null)
    .select('id');

  if (claimError || !claimed || claimed.length === 0) {
    return;
  }

  let result;
  try {
    const url = `${SITE_URL}/blog/${post.slug}`;
    result = await publishThreadsText(buildArticlePostText(post.title, url));
  } catch (e) {
    result = {
      outcome: 'transient' as const,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  if (result.outcome === 'published') {
    await admin
      .from('platform_blog_posts')
      .update({ threads_post_id: result.postId ?? null })
      .eq('id', post.id)
      .is('threads_post_id', null);
    return;
  }

  if (result.outcome === 'permanent') {
    alertWarning(
      `[platform-blog] Threads 投稿が恒久的に失敗しました（id=${post.id}）: ${result.reason ?? 'unknown'}`,
      { route: '/api/admin/platform-blog/[id]' }
    );
  }

  await admin
    .from('platform_blog_posts')
    .update({ threads_posted_at: null })
    .eq('id', post.id)
    .is('threads_post_id', null);
}

const platformBlogUpdateSchema = z.object({
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/, 'スラッグは半角英数字とハイフンのみ使用できます').optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  reading_time: z.number().int().min(1).max(999).optional(),
  // platform_blog_posts.content は jsonb 列（Database 型では Json）。z.unknown() だと値の型が
  // unknown になり Json に代入できず tsc エラーになる。z.custom<Json>() はデフォルトで常に許可
  // （実行時バリデーションは従来どおり無し）のまま出力型だけ Json に合わせるため、実行時の
  // 受け入れ範囲は変えていない（route.ts の POST と同じ理由）。
  content: z.array(z.record(z.string(), z.custom<Json>())).optional(),
  is_published: z.boolean().optional(),
});

// Record<string, unknown> だと Supabase の update() が要求する platform_blog_posts.Update 型
// （余剰プロパティ拒否・列ごとの型）と合わず tsc エラーになるため、Database 由来の Update 型で
// 宣言する（gbp_posts の PATCH と同じ理由・実行時の組み立て方は変更なし）。
type PlatformBlogUpdate = Database['public']['Tables']['platform_blog_posts']['Update'];

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-platform-blog-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const adminUser = await requirePlatformAdmin();
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const userId = adminUser.id;

  const body = await request.json().catch(() => null);
  const parsed = platformBlogUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  // description/category は migration(20260417000025)上 NOT NULL DEFAULT ''（null 不可）。
  // zod は「クリアする」入力を受け付けるため .nullable() にしているが、そのまま
  // { ...parsed.data } で spread すると description: null 等が Update 型（string|undefined）に
  // 弾かれる。未指定（undefined）のキーはそもそも更新対象に含めず、明示 null は「空文字へ
  // クリア」として扱う（PATCH は部分更新なので、指定していない列を巻き込まないよう
  // slug/title/tags/reading_time/is_published/content はそのまま spread し、
  // description/category/content だけ個別に組み立てる）。
  const { description, category, content, ...rest } = parsed.data;
  const updatePayload: PlatformBlogUpdate = { ...rest };
  if (description !== undefined) updatePayload.description = description ?? '';
  if (category !== undefined) updatePayload.category = category ?? '';
  if (content !== undefined) updatePayload.content = content;
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

  if (error) return serverError('admin-platform-blog-patch', error, '/api/admin/platform-blog/[id]');
  if (!data) return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId,
    action: 'update',
    tableName: 'platform_blog_posts',
    recordId: params.id,
    newValues: updatePayload,
    ipAddress: ip,
  });

  // 更新結果が公開状態なら Threads へ配線する。false→true の遷移だけを狙って旧 is_published を
  // 別途 SELECT で取得する必要はない：publishArticleToThreads 内の CAS が
  // 「threads_post_id IS NULL の記事に限る」を保証するため、一度成功した記事は
  // このガードだけで自動的に再投稿されなくなる（公開のままの編集保存を何度繰り返しても、
  // 実際に Threads へ投稿されるのは最初の1回だけ）。
  if (data.is_published) {
    runAfterResponse(() => publishArticleToThreads(admin, { id: data.id, slug: data.slug, title: data.title }));
  }

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

  const adminUser = await requirePlatformAdmin();
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const userId = adminUser.id;

  const admin = createServiceRoleClient();
  // 【2026年7月10日 恒久根治】削除件数を検証せず常に成功を返していたため、存在しないIDの
  // 削除試行（0件削除）も「成功」と偽装していた（phantom success）。.select() で削除された
  // 行を受け取り、0件なら404を返す。
  const { data, error } = await admin
    .from('platform_blog_posts')
    .delete()
    .eq('id', params.id)
    .select();

  if (error) return serverError('admin-platform-blog-delete', error, '/api/admin/platform-blog/[id]');
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

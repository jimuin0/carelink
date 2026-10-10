import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';
import { alertWarning } from './alert';
import { publishThreadsText, buildArticlePostText, readThreadsContainerStatus } from './threads';
import { SITE_URL } from './constants';

type Admin = ReturnType<typeof createServiceRoleClient>;
type RpcResponse = { data: unknown; error: unknown };
const claimSchema = z.object({ attemptId: z.string().uuid(), title: z.string(), slug: z.string() });
export type ArticleDelivery = 'published' | 'skipped' | 'transient' | 'permanent' | 'ambiguous' | 'raced' | 'unavailable';
async function rpc(db: Admin, name: string, args: Record<string, unknown>): Promise<RpcResponse> {
  const call = db.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<RpcResponse>;
  try { return await call.call(db, name, args); }
  catch { return { data: null, error: new Error('THREADS_DEPENDENCY_UNAVAILABLE') }; }
}
export async function publishArticleToThreads(db: Admin, post: { id: string; slug: string; title: string }, route: string): Promise<ArticleDelivery> {
  const response = await rpc(db, 'claim_threads_article', { p_post_id: post.id });
  if (response.error !== null) return 'unavailable';
  if (response.data === null) return 'raced';
  const claim = claimSchema.safeParse(response.data);
  if (!claim.success) return 'unavailable';
  const attempt = claim.data.attemptId;
  let result;
  try {
    result = await publishThreadsText(buildArticlePostText(claim.data.title, `${SITE_URL}/blog/${claim.data.slug}`), {
      beforePublish: async creationId => {
        const start = await rpc(db, 'start_threads_article_publish', { p_post_id: post.id, p_attempt_id: attempt, p_creation_id: creationId });
        if (start.error !== null || start.data !== true) throw new Error('THREADS_START_UNVERIFIED');
      },
    });
  } catch { result = { outcome: 'unknown' as const }; }
  // Missing/malformed replies never authorize release. Only prepublication
  // failures may become retryable; the SQL start marker independently guards it.
  const outcome = result?.outcome === 'published' && typeof result.postId === 'string' && /^[0-9]{1,100}$/.test(result.postId)
    ? 'published' : ['skipped','transient','permanent'].includes(result?.outcome) ? result.outcome : 'unknown';
  const finish = await rpc(db, 'finish_threads_article_publish', { p_post_id: post.id, p_attempt_id: attempt,
    p_outcome: outcome, p_post_id_external: outcome === 'published' ? result.postId : null });
  if (finish.error !== null || !['published','skipped','transient','permanent','ambiguous'].includes(finish.data as string)) {
    alertWarning('[platform-blog] Threads投稿の結果記録を確認できません。再投稿せず照合してください。', { route });
    return 'ambiguous';
  }
  const state = finish.data as Exclude<ArticleDelivery, 'raced' | 'unavailable'>;
  if (state === 'ambiguous' || state === 'permanent') {
    alertWarning('[platform-blog] Threads投稿は照合または設定確認が必要です。自動で再公開しません。', { route });
  }
  return state;
}

export async function reconcileArticleThreads(db: Admin, post: { id: string; attemptId: string | null; creationId: string | null }): Promise<boolean> {
  if (!post.attemptId || !post.creationId) return false;
  const status = await readThreadsContainerStatus(post.creationId);
  if (status !== 'PUBLISHED') return false;
  const result = await rpc(db, 'reconcile_threads_article_publish', { p_post_id: post.id, p_attempt_id: post.attemptId,
    p_creation_id: post.creationId, p_provider_status: status });
  return result.error === null && result.data === true;
}

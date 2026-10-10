/** All automatic and inline publication uses the same durable RPC protocol.
 * Stale prepublication claims may retry; a public POST start never expires.
 * Reconciliation only performs provider GETs, never publish/delete requests. */
import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun, cronError } from '@/lib/cron-logger';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { publishArticleToThreads, reconcileArticleThreads } from '@/lib/platform-blog-threads';
import { alertDeliveryFailures } from '@/lib/alert';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const SELF = 'threads-backfill';
const CAP = 8;
const candidatesFilter = (before: string) => `and(threads_post_status.is.null,threads_posted_at.is.null),and(threads_post_status.in.(claimed,permanent),threads_posted_at.lt.${before})`;
const heldFilter = (before: string) => `threads_post_status.eq.ambiguous,and(threads_post_status.eq.started,threads_posted_at.lt.${before}),and(threads_post_status.is.null,threads_posted_at.not.is.null,threads_posted_at.lt.${before})`;

export async function GET(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  try {
    const db = createServiceRoleClient();
    const holdBefore = new Date(Date.now() - 60_000).toISOString();
    const heldCount = await db.from('platform_blog_posts').select('id', { count: 'exact', head: true })
      .is('threads_post_id', null).or(heldFilter(holdBefore));
    if (heldCount.error || typeof heldCount.count !== 'number') return cronError(SELF, startedAt, new Error('THREADS_HOLD_OBSERVATION_UNAVAILABLE'));
    const held = await db.from('platform_blog_posts').select('id,threads_delivery_attempt_id,threads_creation_id')
      .is('threads_post_id', null).or(heldFilter(holdBefore)).order('threads_posted_at', { ascending: true }).limit(CAP);
    if (held.error || !Array.isArray(held.data)) return cronError(SELF, startedAt, new Error('THREADS_RECONCILIATION_UNAVAILABLE'));
    let reconciled = 0;
    for (const row of held.data as unknown as { id: string; threads_delivery_attempt_id: string | null; threads_creation_id: string | null }[]) {
      if (await reconcileArticleThreads(db, { id: row.id, attemptId: row.threads_delivery_attempt_id, creationId: row.threads_creation_id })) reconciled++;
    }
    let uncertain = Math.max(0, heldCount.count - reconciled);
    const retryBefore = new Date(Date.now() - 4 * 60 * 60_000).toISOString();
    const count = await db.from('platform_blog_posts').select('id', { count: 'exact', head: true })
      .eq('is_published', true).is('threads_post_id', null).is('threads_delivery_started_at', null).or(candidatesFilter(retryBefore));
    if (count.error || typeof count.count !== 'number') return cronError(SELF, startedAt, new Error('THREADS_CANDIDATE_COUNT_UNAVAILABLE'));
    const fetched = await db.from('platform_blog_posts').select('id,title,slug').eq('is_published', true)
      .is('threads_post_id', null).is('threads_delivery_started_at', null).or(candidatesFilter(retryBefore))
      .order('created_at', { ascending: true }).limit(CAP);
    if (fetched.error || !Array.isArray(fetched.data)) return cronError(SELF, startedAt, new Error('THREADS_CANDIDATE_READ_UNAVAILABLE'));
    const counters = { published: 0, permanent: 0, transient: 0, skipped: 0, raced: 0, unavailable: 0 };
    for (const post of fetched.data as { id: string; title: string; slug: string }[]) {
      const state = await publishArticleToThreads(db, post, `/api/cron/${SELF}`);
      if (state === 'ambiguous') uncertain++;
      else counters[state]++;
      if (state === 'skipped') break;
    }
    const truncated = count.count > fetched.data.length;
    const meta = { ...counters, reconciled, uncertain, totalEligible: count.count, candidates: fetched.data.length, truncated };
    alertDeliveryFailures(SELF, counters.transient + counters.unavailable + uncertain, meta);
    if (uncertain || counters.unavailable || counters.transient || counters.permanent) {
      return cronError(SELF, startedAt, new Error('THREADS_DELIVERY_REQUIRES_RECONCILIATION'), { message: 'Threads投稿の照合が必要です', extraLog: { meta }, extraBody: meta });
    }
    await logCronRun(SELF, counters.published || reconciled ? 'success' : 'skipped', startedAt,
      { processed: counters.published, skipped: counters.skipped + counters.raced, meta });
    return NextResponse.json({ processed: counters.published, reconciled, skipped: counters.skipped + counters.raced, truncated });
  } catch { return cronError(SELF, startedAt, new Error('THREADS_DEPENDENCY_UNAVAILABLE')); }
}

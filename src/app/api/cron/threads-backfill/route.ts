/**
 * Threads 投稿バックフィル Cron
 * GET /api/cron/threads-backfill（毎時）
 *
 * 記事公開時のインライン投稿（src/app/api/admin/platform-blog/route.ts・[id]/route.ts の
 * publishArticleToThreads）が一時的な失敗（transient）で終わった記事を拾い直す自己修復役。
 * `platform_blog_posts` は `is_published=true かつ threads_post_id IS NULL` の行を対象に、
 * buildArticlePostText() で本文を作って publishThreadsText() で投稿する。
 *
 * 🔴 【claim の設計＝インライン投稿と完全に同じ列・同じ条件を使う】
 * インライン投稿（上記ファイル）は `threads_posted_at` を claim キーに使い、
 * `threads_post_id IS NULL AND threads_posted_at IS NULL` を claim の必要条件にしている
 * （コメント: 「投稿してから記録する」ではなく「投稿する前に claim を立てる」を採用、とある）。
 * 本 cron は同じ記事行を同じ2列で扱うため、【違う claim 方式を使うと2つの投稿経路が
 * 互いを認識できずレースする】。よって本 cron もまったく同じ claim 条件・同じ列を使う
 * （二重投稿を構造的に防ぐ・CAS＝条件付き UPDATE + `.select('id')` で claim 成否を判定）。
 *
 * 🔴 【permanent（恒久失敗）の扱い＝インライン投稿と同じ「claim 解放」ではなく、あえて保持する】
 * platform_blog_posts は「投稿済みマーカーは threads_post_id の非 null のみ」という設計
 * （supabase/migrations/20260821000001_threads.sql のコメント参照）で、恒久失敗を記録する
 * 専用の列が無い。インライン投稿側はこの制約の下で「claim を解放し、次の編集保存でも
 * 同じ理由で再試行・再通知させる（直るまで気づき続けられる形）」を選んでいる
 * （1回の保存操作につき最大1回の再試行なので許容できる）。
 *
 * 本 cron は【毎時】走るため、同じ設計をそのまま持ち込むと、直らない記事が
 * MAX_POSTS_PER_RUN の枠を毎時間占有し続け、新着記事の投稿枠を奪い続ける
 * （CLAUDE.md Issue #417「恒久エラーを transient と同じに扱うと、毎回必ず失敗する処理を
 * 永久に繰り返す」と同型の問題）。そこで permanent の場合だけ claim を【解放しない】。
 * 空いた行は下記の stale reclaim（CLAIM_STALE_MS 経過後）まで再選出されないため、
 * 実質的に「恒久失敗はクールダウンを置いてから再試行」になる。
 * インライン投稿側の claim 判定コメントは「claim できなかった＝…過去の試行が claim を
 * 保持したまま」を正常系として明記しているため、この保持は既存の設計と矛盾しない
 * （インライン側の再試行が一時的に見送られるだけで、cooldown 経過後は双方から
 * 再び claim 可能になる）。
 *
 * 【1 run の件数上限】Threads は 24時間250投稿まで（docs/threads-auto-post-design.md §1）。
 * 毎時発火のため、上限を低く抑えないと 24 run 合計で容易に日次上限へ達する。
 * MAX_POSTS_PER_RUN=8 → 最大 8*24=192/日。インライン投稿分の余地を残すため
 * 250 の全部は使わない（192/250 ≈ 77%）。上限で打ち切った場合は必ずログに出す
 * （no silent caps）。
 */

import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun, cronError } from '@/lib/cron-logger';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { publishThreadsText, buildArticlePostText, type ThreadsPublishResult } from '@/lib/threads';
import { alertDeliveryFailures, alertWarning } from '@/lib/alert';
import { errorMessage } from '@/lib/err';
import { SITE_URL } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SELF = 'threads-backfill';

/** 1 run で投稿を試みる最大件数（上記コメント参照）。 */
const MAX_POSTS_PER_RUN = 8;

/**
 * claim（threads_posted_at）が「固着」とみなされ再選出可能になるまでの経過時間。
 * 2つの目的を1列で兼ねる（列を増やせない制約下での設計。上記コメント参照）：
 *   (1) クラッシュ等で claim だけ立って結果が書き込まれなかった行の自己修復
 *       （webhook-retry の stale processing reclaim と同型）。
 *   (2) permanent と判定した行を毎時間必ず再試行させないためのクールダウン。
 * 数時間あれば当日中にクラッシュから回復でき、かつ恒久失敗の再試行頻度を
 * 24回/日 → 6回/日 程度まで落とせる値として 4 時間を選んだ。
 */
const CLAIM_STALE_MS = 4 * 60 * 60 * 1000;

interface Candidate {
  id: string;
  title: string;
  slug: string;
}

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();

  try {
    const supabase = createServiceRoleClient();

    // Step 0: stale claim reclaim（自己修復・上記コメント参照）。失敗しても本体は継続する
    // （webhook-retry の stale processing reclaim と同方針・best-effort）。
    const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
    const { error: reclaimErr } = await supabase
      .from('platform_blog_posts')
      .update({ threads_posted_at: null })
      .is('threads_post_id', null)
      .not('threads_posted_at', 'is', null)
      .lt('threads_posted_at', staleBefore);
    if (reclaimErr) {
      console.error('[threads-backfill] stale claim reclaim failed (continuing)', {
        err: errorMessage(reclaimErr),
      });
    }

    // Step 1: 対象総数（上限で打ち切った事実をログに残すための可視化用）。
    const { count: totalEligible, error: countErr } = await supabase
      .from('platform_blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('is_published', true)
      .is('threads_post_id', null)
      .is('threads_posted_at', null);

    if (countErr) {
      return cronError(SELF, startedAt, countErr, { message: 'Internal Server Error' });
    }

    // Step 2: 候補取得（古い順＝FIFO。バックログを先に消化する）。
    const { data: candidatesRaw, error: fetchErr } = await supabase
      .from('platform_blog_posts')
      .select('id, title, slug')
      .eq('is_published', true)
      .is('threads_post_id', null)
      .is('threads_posted_at', null)
      .order('created_at', { ascending: true })
      .limit(MAX_POSTS_PER_RUN);

    if (fetchErr) {
      return cronError(SELF, startedAt, fetchErr, { message: 'Internal Server Error' });
    }

    const candidates = (candidatesRaw ?? []) as Candidate[];

    if (candidates.length === 0) {
      await logCronRun(SELF, 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, status: 'ok' });
    }

    // count クエリが null を返す（ドライバ表現揺れ等）場合は候補件数を下限として使う。
    // その場合 effectiveTotal === candidates.length になり truncated は必ず false になる
    // （= totalEligible 不明時は「打ち切った」と過大に主張しない安全側）。
    const effectiveTotal = totalEligible ?? candidates.length;
    const truncated = effectiveTotal > candidates.length;
    if (truncated) {
      // 🔴 no silent caps: 上限で打ち切った事実を必ず可視化する。
      console.warn('[threads-backfill] per-run cap reached, remaining candidates deferred to next run', {
        cap: MAX_POSTS_PER_RUN,
        totalEligible,
        deferred: effectiveTotal - candidates.length,
      });
    }

    let published = 0;
    let permanentFailures = 0;
    let transientFailures = 0;
    let raced = 0;
    let skippedNotConfigured = 0;
    let claimErrors = 0;

    for (const post of candidates) {
      const nowIso = new Date().toISOString();
      const { data: claimed, error: claimErr } = await supabase
        .from('platform_blog_posts')
        .update({ threads_posted_at: nowIso })
        .eq('id', post.id)
        .is('threads_post_id', null)
        .is('threads_posted_at', null)
        .select('id');

      if (claimErr) {
        // DB エラーで判定材料が欠けるため投稿しない（fail-safe）。無音にせず可視化のうえ、
        // 次 run で再評価させる（threads_posted_at は書いていないので候補として残り続ける）。
        console.error('[threads-backfill] claim failed', { postId: post.id, err: errorMessage(claimErr) });
        claimErrors++;
        continue;
      }
      if (!claimed || claimed.length === 0) {
        // 他プロセス（インライン投稿など）が先に claim 済み。二重投稿を避けるため何もしない。
        raced++;
        continue;
      }

      let result: ThreadsPublishResult;
      try {
        const url = `${SITE_URL}/blog/${post.slug}`;
        result = await publishThreadsText(buildArticlePostText(post.title, url));
      } catch (e) {
        // publishThreadsText は例外を投げず outcome を返す契約だが、契約違反時に claim が
        // 解放されないまま恒久的に固着する事故を避けるため transient 相当として扱う
        // （インライン投稿側の同種の防御的 catch と同じ考え方）。
        result = { outcome: 'transient', reason: errorMessage(e) };
      }

      if (result.outcome === 'published') {
        const { error: finalizeErr } = await supabase
          .from('platform_blog_posts')
          .update({ threads_post_id: result.postId ?? null })
          .eq('id', post.id)
          .is('threads_post_id', null);
        if (finalizeErr) {
          // 投稿自体は完了済み。記録できないと reclaim 経由で再投稿され二重投稿になりうるため可視化する。
          console.error('[threads-backfill] CRITICAL: posted but could not record threads_post_id — possible duplicate on next run', {
            postId: post.id,
            err: errorMessage(finalizeErr),
          });
        }
        published++;
        continue;
      }

      if (result.outcome === 'permanent') {
        permanentFailures++;
        // 🔴 claim を解放しない（上記コメント参照）＝ CLAIM_STALE_MS が経過するまで再選出されない。
        // 「気づかないまま繰り返す」を避けるため、集約通知とは別に都度アラートする
        // （インライン投稿側の alertWarning と同じ形・Slack のスレッド集約で洪水は防がれる）。
        alertWarning(
          `[threads-backfill] Threads 投稿が恒久的に失敗しました（記事ID=${post.id}）: ${result.reason ?? 'unknown'}`,
          { route: `/api/cron/${SELF}` }
        );
        continue;
      }

      // transient / skipped は claim を解放する（次回また候補として拾う）。
      const { error: releaseErr } = await supabase
        .from('platform_blog_posts')
        .update({ threads_posted_at: null })
        .eq('id', post.id)
        .is('threads_post_id', null);
      if (releaseErr) {
        console.error('[threads-backfill] claim release failed', { postId: post.id, err: errorMessage(releaseErr) });
      }

      if (result.outcome === 'skipped') {
        // Threads 未設定はこの run の全候補に共通する状態なので、残りの候補で同じ判定を
        // 繰り返して無駄打ちしない（CAP を空費しない）。未設定→設定完了への切り替わりは
        // 次回 run で毎回再評価されるため検知漏れは無い。
        skippedNotConfigured++;
        break;
      }

      transientFailures++;
    }

    alertDeliveryFailures(SELF, transientFailures, { published, permanentFailures, raced, claimErrors });

    const skippedTotal = permanentFailures + transientFailures + raced + skippedNotConfigured + claimErrors;
    // published も他の分類も一切無く「未設定でスキップ」しかしていない run は、
    // 他 cron の「対象0件」と同じ意味（正常・処理対象なし）として扱う。
    const overallStatus: 'success' | 'skipped' =
      published === 0 &&
      permanentFailures === 0 &&
      transientFailures === 0 &&
      raced === 0 &&
      claimErrors === 0 &&
      skippedNotConfigured > 0
        ? 'skipped'
        : 'success';

    await logCronRun(SELF, overallStatus, startedAt, {
      processed: published,
      skipped: skippedTotal,
      meta: {
        totalEligible,
        candidates: candidates.length,
        truncated,
        published,
        permanentFailures,
        transientFailures,
        raced,
        claimErrors,
        skippedNotConfigured,
      },
    });

    return NextResponse.json({ processed: published, skipped: skippedTotal, truncated });
  } catch (e) {
    return cronError(SELF, startedAt, e);
  }
}

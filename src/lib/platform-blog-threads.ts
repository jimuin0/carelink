/**
 * プラットフォームブログ記事の Threads 自動投稿（2026年8月21日 新設）
 *
 * 🔴 **なぜ独立モジュールにしているか。** この処理は POST（新規作成時に公開）と
 * PATCH（非公開→公開）の2経路から呼ばれる。route.ts は HTTP メソッド以外を export
 * できないため、素直に書くと同じ関数が2ファイルに複製される。
 * ここには **claim のプロトコル**（どの列を条件に、どの順で焼き切るか）が入っており、
 * 2つの複製が少しでもズレると【片方だけが二重投稿する】。しかも
 * `src/app/api/cron/threads-backfill` が同じ3条件で行を選ぶため、ズレは3者間に波及する。
 * 「同じであること」をレビューで担保するのは無理なので、1箇所に集約している。
 */
import { createServiceRoleClient } from '@/lib/supabase-server';
import { alertWarning } from '@/lib/alert';
import { publishThreadsText, buildArticlePostText } from '@/lib/threads';
import { SITE_URL } from '@/lib/constants';

export async function publishArticleToThreads(
  admin: ReturnType<typeof createServiceRoleClient>,
  post: { id: string; slug: string; title: string },
  route: string
): Promise<void> {
  const nowIso = new Date().toISOString();

  // claim: 同時に複数リクエストが来ても、threads_posted_at を実際に null → 非null へ
  // 遷移させられるのは1件だけ（行ロックにより原子的）。
  const { data: claimed, error: claimError } = await admin
    .from('platform_blog_posts')
    .update({ threads_posted_at: nowIso })
    .eq('id', post.id)
    .is('threads_post_id', null)
    .is('threads_posted_at', null)
    .select('id');

  if (claimError || !claimed || claimed.length === 0) {
    // claim できなかった = 既に投稿済み／投稿処理中／過去の試行が claim を保持したまま。
    // 二重投稿を避けるのが目的なので、ここは正常系として何もしない。
    return;
  }

  let result;
  try {
    const url = `${SITE_URL}/blog/${post.slug}`;
    result = await publishThreadsText(buildArticlePostText(post.title, url));
  } catch (e) {
    // publishThreadsText はエラーを outcome として返す契約だが、想定外の throw で
    // claim が解放されないまま恒久的に固着する（＝以後二度と投稿もアラートも発生しない）
    // 事故を避けるため、transient 相当として扱い claim を解放する。
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
    // トークン失効等＝次回以降も必ず失敗する。専用の記録列が無いため「一度だけ通知」はできず、
    // claim を解放して次の編集保存でも同じ理由で再試行・再通知させる（直るまで気づき続けられる形）。
    alertWarning(
      `[platform-blog] Threads 投稿が恒久的に失敗しました（id=${post.id}）: ${result.reason ?? 'unknown'}`,
      { route }
    );
  }

  // skipped（未設定・正常系）／transient（一時失敗・記録せず backfill cron に任せる）／
  // permanent（上で通知済み）のいずれも、threads_post_id は書かず claim だけ解放する。
  await admin
    .from('platform_blog_posts')
    .update({ threads_posted_at: null })
    .eq('id', post.id)
    .is('threads_post_id', null);
}

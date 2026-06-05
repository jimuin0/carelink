import { logCronRun } from '@/lib/cron-logger';
/**
 * 予約ブログ公開の ISR 反映 Cron（原機能品質向上ラウンド）
 * GET /api/cron/publish-scheduled-blog
 *
 * 施設ブログ(blog_posts)の予約投稿は scheduled_at をクエリ時フィルタ
 * (is_published=true AND scheduled_at<=now) で可視化する設計のため、時刻到来時に
 * 書込イベントが無く、/facility/[slug]/blog 配下の ISR(revalidate=3600) が最大1時間
 * 古いまま＝予約時刻に公開されない遅延が出ていた。
 *
 * 本 cron を短周期(15分)で実行し、直近に scheduled_at が到来した予約投稿の施設ブログを
 * on-demand 再検証する。これで遅延を「全ブログ流入の revalidate 短縮」ではなく
 * 「予約時刻付近の cron 発火」に限定して解消する。再検証は冪等のため窓の重複は無害。
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkCronAuth } from '@/lib/cron-auth';
import { fetchAllPaged } from '@/lib/paginate';
import { isMissingColumnError, warnMissingColumnFallback, type DbError } from '@/lib/db-fallback';
import { revalidateFacilityBlog } from '@/lib/revalidate';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 直近この時間内に scheduled_at が到来した投稿を対象にする（cron 周期15分＋取りこぼし余裕）。
// 冪等な再検証のため窓を広めに取っても害はない（同じブログを複数回 stale 化するだけ）。
const SCHEDULE_WINDOW_MS = 60 * 60 * 1000;

type ScheduledRow = { facility_id: string | null; scheduled_at: string | null };

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  try {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const windowStartIso = new Date(now - SCHEDULE_WINDOW_MS).toISOString();

    // 直近に公開時刻が到来した予約投稿を全件取得（行上限の取りこぼし防止）。
    const { rows: posts, error } = await fetchAllPaged<ScheduledRow>(
      async (offset, limit) => {
        const { data, error: pageErr } = await supabase
          .from('blog_posts')
          .select('facility_id, scheduled_at')
          .eq('is_published', true)
          .gte('scheduled_at', windowStartIso)
          .lte('scheduled_at', nowIso)
          .range(offset, offset + limit - 1);
        return { data: data as ScheduledRow[] | null, error: pageErr };
      },
    );

    if (isMissingColumnError(error as DbError | null)) {
      // scheduled_at 列が未適用の環境では予約投稿機能自体が無効＝再検証対象なし。
      warnMissingColumnFallback('blog_posts.scheduled_at');
      await logCronRun('publish-scheduled-blog', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ status: 'ok', revalidated: 0, reason: 'scheduled_at column absent' });
    }
    if (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await logCronRun('publish-scheduled-blog', 'error', startedAt, { error_msg: msg });
      return NextResponse.json({ error: 'query failed' }, { status: 500 });
    }

    const facilityIds = Array.from(new Set(posts.map((p) => p.facility_id).filter((id): id is string => !!id)));
    if (facilityIds.length === 0) {
      await logCronRun('publish-scheduled-blog', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ status: 'ok', revalidated: 0 });
    }

    // facility_id → slug を一括解決し、該当施設のブログページを再検証する。
    const { data: facs } = await supabase
      .from('facility_profiles')
      .select('id, slug')
      .in('id', facilityIds);

    let revalidated = 0;
    for (const f of (facs ?? []) as { id: string; slug: string | null }[]) {
      revalidateFacilityBlog(f.slug);
      if (f.slug) revalidated++;
    }

    await logCronRun('publish-scheduled-blog', 'success', startedAt, { processed: revalidated, skipped: 0 });
    return NextResponse.json({ status: 'ok', revalidated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[publish-scheduled-blog] Error:', e);
    await logCronRun('publish-scheduled-blog', 'error', startedAt, { error_msg: msg });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { scrapeAndSaveFacility } from '@/lib/hpb-menu';

// Vercel Cron: 夜間に全施設の HPB メニューを取得して hpb_menu_durations を更新する。
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 1 run の実時間予算(maxDuration 未満)。超過分は次回 run へ繰延(no silent cap=ログ可視化)。
const SCRAPE_BUDGET_MS = 50 * 1000;
// 1 回でロードする施設数の上限。
const LOAD_LIMIT = 200;

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const admin = createServiceRoleClient();
  const startedAt = new Date();

  // hpb_sln_id が設定された施設のみ対象(更新が古い順で公平に回す)。
  const { data: facilities, error } = await admin
    .from('facility_profiles')
    .select('id, hpb_sln_id')
    .not('hpb_sln_id', 'is', null)
    .order('id', { ascending: true })
    .limit(LOAD_LIMIT);

  if (error) {
    await logCronRun('hpb-menu-scrape', 'error', startedAt, { error_msg: error.message });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const list = facilities ?? [];
  const results = { facilities: 0, saved: 0, skipped: 0, failed: 0, deferred: 0 };
  const loopStart = Date.now();

  for (let i = 0; i < list.length; i++) {
    if (Date.now() - loopStart > SCRAPE_BUDGET_MS) {
      results.deferred = list.length - i;
      console.warn('[hpb-menu-scrape] time budget exceeded, deferring rest', {
        deferred: results.deferred,
      });
      break;
    }
    const facility = list[i];
    try {
      const r = await scrapeAndSaveFacility(admin, facility.id);
      results.facilities++;
      results.saved += r.ok;
      results.skipped += r.skipped;
      results.failed += r.failed;
    } catch (e) {
      results.failed++;
      console.error('[hpb-menu-scrape] facility scrape failed', {
        facilityId: facility.id,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await logCronRun('hpb-menu-scrape', 'success', startedAt, {
    processed: results.saved,
    skipped: results.skipped,
    meta: { facilities: results.facilities, failed: results.failed, deferred: results.deferred },
  });
  return NextResponse.json(results);
}

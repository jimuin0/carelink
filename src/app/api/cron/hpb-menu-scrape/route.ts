import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { scrapeAndSaveFacility } from '@/lib/hpb-menu';
import { alertWarning } from '@/lib/alert';

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

  // hpb_sln_id が設定された施設のみ対象。
  // 旧実装は .order('id') + .limit(200) で、200 件(実際は時間予算で処理できる件数)を超える
  // HPB 連携施設が出ると id 後方が毎 run スクレイプ対象外になり恒久未更新(silent miss)だった。
  // sync-google-ratings(gbp_synced_at)と対称に hpb_scraped_at 昇順(未処理=NULLS FIRST 優先)で
  // 古い順ローテに変更し、処理ごとに hpb_scraped_at を更新して全施設を順繰りに回す(恒久 miss なし)。
  const { data: facilities, error } = await admin
    .from('facility_profiles')
    .select('id, hpb_sln_id')
    .not('hpb_sln_id', 'is', null)
    .order('hpb_scraped_at', { ascending: true, nullsFirst: true })
    .limit(LOAD_LIMIT);

  if (error) {
    await logCronRun('hpb-menu-scrape', 'error', startedAt, { error_msg: error.message });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const list = facilities ?? [];
  // zeroFetch = hpb_sln_id 設定済みなのに 1 件も取得できなかった施設数。
  // = HPB の HTML 構造変化 / 店舗ID 誤り の発症前シグナル(以前は取れていたメニューが静かに陳腐化
  //   するのを検知する。取得0は saveHpbRows が DB 非書込なので既存データは壊れない=可視化だけが課題)。
  const results = { facilities: 0, saved: 0, skipped: 0, failed: 0, deferred: 0, zeroFetch: 0 };
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
      // 設定済み(slnId あり)なのに 0 件取得 = HPB 構造変化 / 店舗ID 誤り の疑い(発症前検知)。
      if (r.slnId && r.fetched === 0) {
        results.zeroFetch++;
        console.warn('[hpb-menu-scrape] configured facility returned 0 menus (HPB構造変化 or 店舗ID誤りの疑い)', {
          facilityId: facility.id,
          sln: r.slnId,
        });
      }
    } catch (e) {
      results.failed++;
      console.error('[hpb-menu-scrape] facility scrape failed', {
        facilityId: facility.id,
        err: e instanceof Error ? e.message : String(e),
      });
    }

    // 処理ごとに hpb_scraped_at を必ず更新して rotation を進める(成功/失敗いずれも)。
    // これを怠ると古い順 ORDER で同じ先頭集合が毎 run 選ばれ、取得失敗が続く施設が
    // 先頭に居座って他施設のスクレイプを阻害する(=後方が恒久未処理)。
    const { error: stampErr } = await admin
      .from('facility_profiles')
      .update({ hpb_scraped_at: new Date().toISOString() })
      .eq('id', facility.id);
    if (stampErr) {
      // 更新できないと rotation が進まない(次回も先頭に残る)→ failed 計上＋可視化。
      results.failed++;
      console.error('[hpb-menu-scrape] scrape timestamp update failed', {
        facilityId: facility.id,
        err: stampErr.message,
      });
    }
  }

  // 処理対象が有り、かつ全件失敗（failed 全滅）または全件0件取得（zeroFetch 全滅）は
  // HPB 側の HTML 構造変化・アクセス遮断等の深刻な障害の疑いのため無音にせず警報する。
  // 旧実装は failed/zeroFetch 件数に関わらず常に 'success' 記録で、個別施設の
  // console.warn/console.error だけでは Vercel ログに埋没し誰も気づけなかった
  // （1〜数件の失敗はサイト側の一時的な事情もあるため許容し、全滅時のみ昇格する設計）。
  // 分母は results.facilities（try 内の成功パスのみ加算）ではなく実際に試行した件数
  // （list.length - deferred）を使う：scrapeAndSaveFacility が例外を投げる経路では
  // facilities が加算されないため、facilities を分母にすると「全件が例外で失敗」した
  // 最悪ケースほど分母が 0 になり allFailed が絶対に true にならない盲点があった。
  const attempted = list.length - results.deferred;
  const allFailed = attempted > 0 && results.saved === 0 && results.failed >= attempted;
  const allZeroFetch = attempted > 0 && results.zeroFetch >= attempted;
  if (allFailed || allZeroFetch) {
    alertWarning(
      `hpb-menu-scrape: 対象${attempted}件が${allFailed ? '全件失敗' : '全件0件取得'}（HPB構造変化/アクセス遮断の疑い）`,
      { route: '/api/cron/hpb-menu-scrape', extra: { failed: results.failed, zeroFetch: results.zeroFetch, saved: results.saved } },
    );
  }

  await logCronRun('hpb-menu-scrape', 'success', startedAt, {
    processed: results.saved,
    skipped: results.skipped,
    meta: { facilities: results.facilities, failed: results.failed, deferred: results.deferred, zeroFetch: results.zeroFetch, allFailed, allZeroFetch },
  });
  return NextResponse.json(results);
}

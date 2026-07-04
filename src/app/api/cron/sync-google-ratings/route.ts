import { logCronRun } from '@/lib/cron-logger';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { fetchPlaceDetails } from '@/lib/gbp';
import { checkCronAuth } from '@/lib/cron-auth';
import { alertWarning } from '@/lib/alert';

// Vercel Cron: runs every Sunday at 3:00 JST (18:00 UTC Saturday)
export const dynamic = 'force-dynamic';
// 全プラン安全な明示値（Hobby 上限60s / Pro 上限300s のいずれでも有効）。
// 既定の低い値を上書きし、下の SYNC_BUDGET_MS による予算ガードが確実に発火する既知の上限を与える。
export const maxDuration = 60;

// Places API は 1 QPM が安全なため 1 件あたり 1.1s sleep する。
const RATE_LIMIT_MS = 1100;
// 1 回の run の実時間予算。maxDuration(60s) 未満。~50s / 1.1s ≒ 45 件/run を上限に rotation する。
const SYNC_BUDGET_MS = 50 * 1000;
// 1 回でロードする施設数（予算で処理できる件数より少し多めに取り、残りは翌週へ）。
const LOAD_LIMIT = 100;

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const supabase = createServiceRoleClient();
  const startedAt = new Date();

  // gbp_place_id が設定された公開施設を「最終同期が古い順（未同期=NULLS FIRST 優先）」で取得。
  // 旧実装は ORDER BY 無し .limit(200) で、200件×1.1s=220s がタイムアウトし、毎回非決定的な
  // 先頭集合だけ同期 → GBP 連携施設が一定数を超えると一部が永久に未同期だった（silent miss）。
  // gbp_synced_at 昇順 + 予算ガード + 処理ごとに gbp_synced_at 更新で、全施設を週次で順繰りに同期する。
  const { data: facilities, error } = await supabase
    .from('facility_profiles')
    .select('id, gbp_place_id')
    .eq('status', 'published')
    .not('gbp_place_id', 'is', null)
    .order('gbp_synced_at', { ascending: true, nullsFirst: true })
    .limit(LOAD_LIMIT);

  if (error) {
    await logCronRun('sync-google-ratings', 'error', startedAt, { error_msg: error.message });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const list = facilities ?? [];
  // 監査X2: fetchFailed は「Places API 呼び出しが null を返した(例外/401/429/5xx/status≠OK)」件数。
  // 従来はこれを skipped に混ぜていたため、API キー失効・課金停止の全滅時も errors=0 のまま
  // allFailed アラートが構造的に発火しなかった。attempted は place_id 有りで実際に fetch した件数。
  const results = { updated: 0, skipped: 0, errors: 0, fetchFailed: 0, deferred: 0 };
  let attempted = 0;
  const loopStart = Date.now();

  for (let i = 0; i < list.length; i++) {
    // 実時間予算ガード: 残りは gbp_synced_at 未更新のまま翌週 run が古い順で拾う（恒久 miss なし）。
    if (Date.now() - loopStart > SYNC_BUDGET_MS) {
      results.deferred = list.length - i;
      console.warn('[sync-google-ratings] time budget exceeded, deferring rest to next run', { deferred: results.deferred });
      break;
    }

    const facility = list[i];
    // クエリで .not('gbp_place_id','is',null) 済みだが、念のための防御（null が紛れたら skip）。
    if (!facility.gbp_place_id) { results.skipped++; continue; }

    // 処理ごとに gbp_synced_at を必ず更新して rotation を進める（成功/スキップ/失敗いずれも）。
    // これにより、取得失敗が続く施設が先頭に居座って他施設の同期を阻害しない。
    const nowIso = new Date().toISOString();
    const payload: { gbp_synced_at: string; google_rating?: number | null; google_review_count?: number } = { gbp_synced_at: nowIso };
    let outcome: 'updated' | 'skipped' | 'error' | 'fetch_failed' = 'skipped';

    attempted++;
    try {
      const placeData = await fetchPlaceDetails(facility.gbp_place_id);
      if (placeData === null) {
        // fetchPlaceDetails は例外/401/429/5xx/status≠OK を全て null に畳む。
        // これらは API 障害であり「レビュー無し施設」ではないため fetch 失敗として集計する。
        outcome = 'fetch_failed';
      } else if (placeData.rating == null && placeData.user_ratings_total == null) {
        // 取得は成功したがレビューが無い施設（正常なスキップ＝API は稼働）。
        outcome = 'skipped';
      } else {
        payload.google_rating = placeData.rating ?? null;
        payload.google_review_count = placeData.user_ratings_total ?? 0;
        outcome = 'updated';
      }
    } catch {
      outcome = 'error';
    }

    const { error: updateError } = await supabase
      .from('facility_profiles')
      .update(payload)
      .eq('id', facility.id);
    if (updateError) {
      // gbp_synced_at を更新できないと rotation が進まない（次回も先頭に残る）→ error 計上＋可視化。
      console.error('[sync-google-ratings] sync timestamp update failed', { facilityId: facility.id, err: updateError });
      results.errors++;
    } else if (outcome === 'updated') {
      results.updated++;
    } else if (outcome === 'error') {
      results.errors++;
    } else if (outcome === 'fetch_failed') {
      results.fetchFailed++;
    } else {
      results.skipped++;
    }

    // Rate limit: Places API は 1 QPM が安全
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  // 処理対象が有り、かつ1件も更新できず全件エラー（＝Places API キー失効・課金停止等の
  // 深刻な障害の疑い）の場合は無音にせず Slack へ警報する。旧実装は errors 件数に関わらず
  // 常に 'success' 記録で、cron_logs だけを見ても API 障害に気づけない盲点だった
  // （1件だけの失敗はノイズになるため許容し、全滅時のみ昇格する設計）。
  // 実際に fetch した全件が API 失敗で返り、成功(updated)もレビュー無し正常スキップ(skipped)も
  // 1件も無い場合を「全滅」とみなす。1件でも成功/正常スキップがあれば API は稼働中なので発火しない。
  const allFailed = attempted > 0 && results.updated === 0 && results.skipped === 0
    && results.fetchFailed === attempted;
  if (allFailed) {
    alertWarning(
      `sync-google-ratings: fetch対象${attempted}件が全件失敗（Google Places API 障害の疑い）`,
      { route: '/api/cron/sync-google-ratings', extra: { fetchFailed: results.fetchFailed, errors: results.errors, skipped: results.skipped } },
    );
  }

  await logCronRun('sync-google-ratings', 'success', startedAt, {
    processed: results.updated,
    skipped: results.skipped,
    meta: { errors: results.errors, fetchFailed: results.fetchFailed, deferred: results.deferred, allFailed },
  });
  return NextResponse.json({ processed: results.updated, skipped: results.skipped, errors: results.errors, fetchFailed: results.fetchFailed, deferred: results.deferred });
}

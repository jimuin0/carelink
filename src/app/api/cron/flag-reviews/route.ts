import { logCronRun } from '@/lib/cron-logger';
/**
 * 不正レビュー検知 Cron（v8.22）
 * GET /api/cron/flag-reviews
 * 毎時実行: 同一IP/短時間大量投稿を自動フラグ
 *
 * フラグ条件:
 * 1. 同一IPから24時間以内に3件以上の投稿
 * 2. 同一IPから同一施設に複数の投稿
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkCronAuth } from '@/lib/cron-auth';
import { fetchAllPaged } from '@/lib/paginate';
import { alertWarning } from '@/lib/alert';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  // 遅延初期化: モジュールスコープで createClient を呼ぶとビルド時の
  // page data 収集フェーズで env 未設定環境（Vercel preview 等）が
  // "supabaseUrl is required" で落ちるため、リクエスト時に生成する。
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startedAt = new Date();
  let flagged = 0;

  try {
    // 1. 同一IPから24時間以内に3件以上 → スパム疑い
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: bulkSpam, error: rpcError } = await supabase.rpc('find_bulk_review_ips', {
      p_since: since24h,
      p_threshold: 3,
    });
    if (rpcError) {
      // 検知1(同一IP大量投稿スパム)が丸ごと無音で no-op 化する障害。console.error のみだと
      // Vercel ログに埋没し誰も気づけないため、恒久検知として Slack へ警報する
      // （検知2は RPC に依存せず独立して動くため cron 全体は 'success' のまま継続する）。
      console.error('[flag-reviews] find_bulk_review_ips RPC failed:', rpcError);
      alertWarning(
        'flag-reviews: find_bulk_review_ips RPC 失敗（検知1: 同一IP大量投稿スパム検知が無効化）',
        { route: '/api/cron/flag-reviews', extra: { errorMessage: rpcError.message } },
      );
    }

    if (bulkSpam && Array.isArray(bulkSpam)) {
      for (const row of bulkSpam as { reviewer_ip: string }[]) {
        // 同一 IP の未フラグレビューを全件ページング取得（大量スパム時は 1000 件超もあり得るため
        // 無ページングだと db-max-rows(1000) で取りこぼし、フラグ漏れが起きる）。
        const { rows: reviews } = await fetchAllPaged<{ id: string; is_flagged: boolean }>(
          async (offset, limit) => {
            const { data, error } = await supabase
              .from('facility_reviews')
              .select('id, is_flagged')
              .eq('reviewer_ip', row.reviewer_ip)
              .gte('created_at', since24h)
              .eq('is_flagged', false)
              .order('id', { ascending: true })
              .range(offset, offset + limit - 1);
            return { data: data as { id: string; is_flagged: boolean }[] | null, error };
          },
        );

        if (reviews && reviews.length > 0) {
          const { error: updateErr } = await supabase
            .from('facility_reviews')
            .update({ is_flagged: true, flag_reason: `bulk_submission: ${reviews.length} reviews in 24h from same IP` })
            .in('id', reviews.map((r) => r.id));
          if (updateErr) {
            console.error('[flag-reviews] bulk_submission update failed:', updateErr);
          } else {
            flagged += reviews.length;
          }
        }
      }
    }

    // 2. 同一IPから同一施設に複数投稿 → 自作自演疑い
    // 全未フラグ公開レビューを全件ページング取得（無ページングだと db-max-rows(1000) で頭打ちし、
    // 1000 件目以降が自作自演判定の対象から外れて永久にフラグ漏れする・順序不定で同じ先頭集合のみ評価）。
    const { rows: dupFacility } = await fetchAllPaged<{ id: string; reviewer_ip: string; facility_id: string }>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('facility_reviews')
          .select('id, reviewer_ip, facility_id')
          .not('reviewer_ip', 'is', null)
          .eq('is_flagged', false)
          .eq('status', 'published')
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1);
        return { data: data as { id: string; reviewer_ip: string; facility_id: string }[] | null, error };
      },
    );

    {
      // dupFacility は fetchAllPaged の rows（常に配列・空なら下の for が回らないだけ）。
      // IPとfacility_idの組み合わせでグループ化
      const ipFacilityMap = new Map<string, string[]>();
      for (const r of dupFacility) {
        const key = `${r.reviewer_ip}:${r.facility_id}`;
        if (!ipFacilityMap.has(key)) ipFacilityMap.set(key, []);
        ipFacilityMap.get(key)!.push(r.id);
      }

      for (const [, ids] of Array.from(ipFacilityMap)) {
        if (ids.length >= 2) {
          const { error: updateErr } = await supabase
            .from('facility_reviews')
            .update({ is_flagged: true, flag_reason: `duplicate_facility: ${ids.length} reviews from same IP for same facility` })
            .in('id', ids);
          if (updateErr) {
            console.error('[flag-reviews] duplicate_facility update failed:', updateErr);
          } else {
            flagged += ids.length;
          }
        }
      }
    }

    await logCronRun('flag-reviews', 'success', startedAt, { processed: flagged, skipped: 0 });
    return NextResponse.json({ processed: flagged, skipped: 0 });
  } catch (e) {
    console.error('flag-reviews error', e);
    await logCronRun('flag-reviews', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'error', flagged }, { status: 500 });
  }
}

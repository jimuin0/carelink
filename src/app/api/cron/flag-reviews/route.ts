import { logCronRun, cronError } from '@/lib/cron-logger';
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
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkCronAuth } from '@/lib/cron-auth';
import { fetchAllPaged } from '@/lib/paginate';
import { alertWarning } from '@/lib/alert';
import { UUID_REGEX } from '@/lib/constants';
import { retryTransientSupabaseRead, summarizeDependencyError } from '@/lib/err';

export const dynamic = 'force-dynamic';

// Flags and pending queue entries commit together. The returned IDs attest only
// actual mutations, including concurrent removals and reviewed evidence skips.
async function flagReviewsAtomically(supabase:SupabaseClient,items:{id:string;facility_id:string|null}[],flagType:string):Promise<number> {
  const result=await supabase.rpc('flag_review_group_atomic',{p_items:items,p_flag_type:flagType});
  if(result.error) throw result.error;
  if(!Array.isArray(result.data)) throw new Error('REVIEW_FLAG_RESULT_UNCONFIRMED');
  const selected=new Set(items.map(item=>item.id)),returned=new Set<string>();
  for(const row of result.data){
    if(!row || typeof row.id!=='string' || !UUID_REGEX.test(row.id) || !selected.has(row.id) || returned.has(row.id))
      throw new Error('REVIEW_FLAG_RESULT_UNCONFIRMED');
    returned.add(row.id);
  }
  return returned.size;
}

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  // 遅延初期化: モジュールスコープで createClient を呼ぶとビルド時の
  // page data 収集フェーズで env 未設定環境（Vercel preview 等）が
  // "supabaseUrl is required" で落ちるため、リクエスト時に生成する。
  const startedAt = new Date();
  let flagged = 0;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    // 1. 同一IPから24時間以内に3件以上 → スパム疑い
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: bulkSpam, error: rpcError } = await retryTransientSupabaseRead(() =>
      supabase.rpc('find_bulk_review_ips', {
        p_since: since24h,
        p_threshold: 3,
      }),
    );
    if (rpcError) {
      // 検知1(同一IP大量投稿スパム)が丸ごと無音で no-op 化する障害。console.error のみだと
      // Vercel ログに埋没し誰も気づけないため、恒久検知として Slack へ警報する
      // （検知2は RPC に依存せず独立して動くため cron 全体は 'success' のまま継続する）。
      console.error('[flag-reviews] find_bulk_review_ips RPC failed:', {
        errorMessage: summarizeDependencyError(rpcError),
      });
      alertWarning(
        'flag-reviews: find_bulk_review_ips RPC 失敗（検知1: 同一IP大量投稿スパム検知が無効化）',
        { route: '/api/cron/flag-reviews', extra: { errorMessage: summarizeDependencyError(rpcError) } },
      );
      return cronError('flag-reviews', startedAt, rpcError, { message: 'error' });
    }

    if (bulkSpam && Array.isArray(bulkSpam)) {
      for (const row of bulkSpam as { reviewer_ip: string }[]) {
        // 同一 IP の未フラグレビューを全件ページング取得（大量スパム時は 1000 件超もあり得るため
        // 無ページングだと db-max-rows(1000) で取りこぼし、フラグ漏れが起きる）。
        const { rows: reviews, error: reviewsError } = await fetchAllPaged<{ id: string; facility_id: string | null }>(
          async (offset, limit) => {
            const { data, error } = await supabase
              .from('facility_reviews')
              .select('id, facility_id')
              .eq('reviewer_ip', row.reviewer_ip)
              .gte('created_at', since24h)
              .eq('is_flagged', false)
              .order('id', { ascending: true })
              .range(offset, offset + limit - 1);
            return { data: data as { id: string; facility_id: string | null }[] | null, error };
          },
        );

        if (reviewsError) throw reviewsError;

        if (reviews && reviews.length > 0) {
          flagged += await flagReviewsAtomically(supabase,reviews,'bulk_submission');
        }
      }
    }

    // 2. 同一IPから同一施設に複数投稿 → 自作自演疑い
    // 全未フラグ公開レビューを全件ページング取得（無ページングだと db-max-rows(1000) で頭打ちし、
    // 1000 件目以降が自作自演判定の対象から外れて永久にフラグ漏れする・順序不定で同じ先頭集合のみ評価）。
    const { rows: dupFacility, error: dupFacilityError } = await fetchAllPaged<{ id: string; reviewer_ip: string; facility_id: string }>(
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

    if (dupFacilityError) throw dupFacilityError;

    {
      // dupFacility は fetchAllPaged の rows（常に配列・空なら下の for が回らないだけ）。
      // IPとfacility_idの組み合わせでグループ化。facility_id は moderation_queue 投入にも使うため
      // 値として保持する（reviewer_ip は IPv6 で ':' を含み得るためキー分割で復元しない）。
      const ipFacilityMap = new Map<string, { facilityId: string; ids: string[] }>();
      for (const r of dupFacility) {
        const key = `${r.reviewer_ip}:${r.facility_id}`;
        if (!ipFacilityMap.has(key)) ipFacilityMap.set(key, { facilityId: r.facility_id, ids: [] });
        ipFacilityMap.get(key)!.ids.push(r.id);
      }

      for (const [, group] of Array.from(ipFacilityMap)) {
        const ids = group.ids;
        if (ids.length >= 2) {
          flagged += await flagReviewsAtomically(supabase,ids.map(id=>({id,facility_id:group.facilityId})),'duplicate_facility');
        }
      }
    }

    await logCronRun('flag-reviews', 'success', startedAt, { processed: flagged, skipped: 0 });
    return NextResponse.json({ processed: flagged, skipped: 0 });
  } catch (e) {
    console.error('flag-reviews error', { errorMessage: summarizeDependencyError(e) });
    return cronError('flag-reviews', startedAt, e, { message: 'error', extraBody: { flagged } });
  }
}

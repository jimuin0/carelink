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

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

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
      console.error('[flag-reviews] find_bulk_review_ips RPC failed:', rpcError);
    }

    if (bulkSpam && Array.isArray(bulkSpam)) {
      for (const row of bulkSpam as { reviewer_ip: string }[]) {
        const { data: reviews } = await supabase
          .from('facility_reviews')
          .select('id, is_flagged')
          .eq('reviewer_ip', row.reviewer_ip)
          .gte('created_at', since24h)
          .eq('is_flagged', false);

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
    const { data: dupFacility } = await supabase
      .from('facility_reviews')
      .select('id, reviewer_ip, facility_id')
      .not('reviewer_ip', 'is', null)
      .eq('is_flagged', false)
      .eq('status', 'published');

    if (dupFacility) {
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

    await logCronRun('flag-reviews', 'success', startedAt, { processed: flagged });
    return NextResponse.json({ success: true, flagged });
  } catch (e) {
    console.error('flag-reviews error', e);
    await logCronRun('flag-reviews', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'error', flagged }, { status: 500 });
  }
}

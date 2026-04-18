import { logCronRun } from '@/lib/cron-logger';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { fetchPlaceDetails } from '@/lib/gbp';

// Vercel Cron: runs every Sunday at 3:00 JST (18:00 UTC Saturday)
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const startedAt = new Date();

  // gbp_place_id が設定された公開施設を全件取得
  const { data: facilities, error } = await supabase
    .from('facility_profiles')
    .select('id, gbp_place_id')
    .eq('status', 'published')
    .not('gbp_place_id', 'is', null);

  if (error) {
    await logCronRun('sync-google-ratings', 'error', startedAt, { error_msg: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = { updated: 0, skipped: 0, errors: 0 };

  for (const facility of facilities ?? []) {
    if (!facility.gbp_place_id) { results.skipped++; continue; }

    try {
      const placeData = await fetchPlaceDetails(facility.gbp_place_id);
      if (!placeData || (placeData.rating == null && placeData.user_ratings_total == null)) {
        results.skipped++;
        continue;
      }

      const { error: updateError } = await supabase
        .from('facility_profiles')
        .update({
          google_rating: placeData.rating ?? null,
          google_review_count: placeData.user_ratings_total ?? 0,
        })
        .eq('id', facility.id);

      if (updateError) { results.errors++; continue; }
      results.updated++;
    } catch {
      results.errors++;
    }

    // Rate limit: Places API は 1 QPM が安全
    await new Promise((r) => setTimeout(r, 1100));
  }

  await logCronRun('sync-google-ratings', 'success', startedAt, {
    processed: results.updated,
    skipped: results.skipped,
    meta: { errors: results.errors },
  });
  return NextResponse.json({ ok: true, ...results });
}

import { NextRequest, NextResponse } from 'next/server';
import { serverError } from '@/lib/with-route';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'stations')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  try {
    const q = request.nextUrl.searchParams.get('q')?.trim() || '';
    const supabase = createServerSupabaseClient();

    // 公開施設の最寄り駅を DB 側で重複なしにして最大 200 件取る（点検 B3-4・migration 20261114300300）。
    // 以前は DISTINCT なしで 200 行読んでから重複を除いていたため、同じ駅の施設が多いと他の駅が欠けた。
    // 部分一致のエスケープも RPC が行う。
    const { data, error } = await supabase.rpc('list_published_stations', q.length > 0 ? { p_query: q.slice(0, 50) } : {});
    // DB 障害を「駅候補なし」として CDN に 1 時間配らない（catch で 500・no-store・通知・中 A24）。
    if (error) throw error;

    const stations = (data ?? []).map((r) => r.nearest_station).filter(Boolean);

    return NextResponse.json(
      { stations },
      { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } }
    );
  } catch (e) {
    const response = serverError('api/stations', e, '/api/stations', 'Internal Server Error');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

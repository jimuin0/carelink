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

    let query = supabase
      .from('facility_profiles')
      .select('nearest_station')
      .eq('status', 'published')
      .not('nearest_station', 'is', null);

    if (q.length > 0) {
      const escaped = q.slice(0, 50).replace(/[%_\\]/g, '\\$&');
      query = query.ilike('nearest_station', `%${escaped}%`);
    }

    const { data, error } = await query.limit(200);
    // DB 障害を「駅候補なし」として CDN に 1 時間配らない（catch で 500・no-store・通知・中 A24）。
    if (error) throw error;

    const stations = Array.from(new Set((data || []).map((r) => r.nearest_station).filter(Boolean) as string[])).sort();

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

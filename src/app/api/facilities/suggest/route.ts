import { serverError } from '@/lib/with-route';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 30, 60_000, 'suggest')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 1) {
    return NextResponse.json({ facilities: [], areas: [] });
  }

  try {
    const escaped = q.slice(0, 50).replace(/[%_\\]/g, '\\$&');
    const supabase = createServerSupabaseClient();

    // Facility name suggestions
    const { data: facilities, error: facilitiesError } = await supabase
      .from('facility_profiles')
      .select('id, name, slug, city, nearest_station, business_type')
      .eq('status', 'published')
      .ilike('name', `%${escaped}%`)
      .limit(5);

    // Area (city / station) suggestions
    const { data: cityData, error: cityError } = await supabase
      .from('facility_profiles')
      .select('city')
      .eq('status', 'published')
      .ilike('city', `%${escaped}%`)
      .limit(10);

    const { data: stationData, error: stationError } = await supabase
      .from('facility_profiles')
      .select('nearest_station')
      .eq('status', 'published')
      .not('nearest_station', 'is', null)
      .ilike('nearest_station', `%${escaped}%`)
      .limit(10);

    // DB 障害を「候補 0 件」の 200 にしない（下の catch で 500＋通知・中 A19）。
    const lookupError = facilitiesError ?? cityError ?? stationError;
    if (lookupError) throw lookupError;

    const areaSet = new Set<string>();
    for (const row of cityData || []) {
      if (row.city) areaSet.add(row.city);
    }
    for (const row of stationData || []) {
      if (row.nearest_station) areaSet.add(row.nearest_station);
    }

    return NextResponse.json({
      facilities: (facilities || []).map((f) => ({
        id: f.id,
        name: f.name,
        slug: f.slug,
        city: f.city,
        nearest_station: f.nearest_station,
        business_type: f.business_type,
      })),
      areas: Array.from(areaSet).slice(0, 5),
    });
  } catch (e) {
    // Sentry 送信は serverError() の内部で行う（ここで呼ぶと同じ例外が二重計上される）。
    // 元の body は error キーを持たない（呼び出し側は facilities/areas だけを読む）。
    // userMessage: null で error キーを足さず、形をそのまま保つ。
    return serverError('facility-suggest', e, '/api/facilities/suggest', null, { facilities: [], areas: [] });
  }
}

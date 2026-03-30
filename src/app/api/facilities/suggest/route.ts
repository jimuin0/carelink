import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { inMemoryRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'suggest')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 1) {
    return NextResponse.json({ facilities: [], areas: [] });
  }

  const escaped = q.slice(0, 50).replace(/[%_\\]/g, '\\$&');
  const supabase = createServerSupabaseClient();

  // Facility name suggestions
  const { data: facilities } = await supabase
    .from('facility_profiles')
    .select('id, name, slug, city, nearest_station, business_type')
    .eq('status', 'published')
    .ilike('name', `%${escaped}%`)
    .limit(5);

  // Area (city / station) suggestions
  const { data: cityData } = await supabase
    .from('facility_profiles')
    .select('city')
    .eq('status', 'published')
    .ilike('city', `%${escaped}%`)
    .limit(10);

  const { data: stationData } = await supabase
    .from('facility_profiles')
    .select('nearest_station')
    .eq('status', 'published')
    .not('nearest_station', 'is', null)
    .ilike('nearest_station', `%${escaped}%`)
    .limit(10);

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
}

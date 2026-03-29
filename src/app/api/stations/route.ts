import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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

  const { data } = await query.limit(200);

  const stations = Array.from(new Set((data || []).map((r) => r.nearest_station).filter(Boolean) as string[])).sort();

  return NextResponse.json(
    { stations },
    { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } }
  );
}

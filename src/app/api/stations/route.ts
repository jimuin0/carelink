import { NextRequest, NextResponse } from 'next/server';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
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

    const { data } = await query.limit(200);

    const stations = Array.from(new Set((data || []).map((r) => r.nearest_station).filter(Boolean) as string[])).sort();

    return NextResponse.json(
      { stations },
      { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } }
    );
  } catch (e) {
    safeCaptureException(e, 'api/stations');
    alertCaughtError('api/stations', e, '/api/stations');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { fetchPlaceDetails, calculateGbpScore } from '@/lib/gbp';
import { checkCsrf } from '@/lib/csrf';

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerSupabaseAuthClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: membership } = await supabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: facility } = await supabase
      .from('facility_profiles')
      .select('gbp_place_id, name, description, phone, website_url, business_hours, main_photo_url')
      .eq('id', membership.facility_id)
      .single();

    if (!facility) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const placeId = req.nextUrl.searchParams.get('placeId') || facility.gbp_place_id;

    const placeData = placeId ? await fetchPlaceDetails(placeId) : null;
    const audit = calculateGbpScore(placeData, facility);

    if (placeData) {
      await Promise.all([
        supabase.from('gbp_audit_cache').upsert({
          facility_id: membership.facility_id,
          score: audit.score,
          details: { audit, placeData },
          fetched_at: new Date().toISOString(),
        }),
        supabase.from('facility_profiles').update({
          google_rating: placeData.rating ?? null,
          google_review_count: placeData.user_ratings_total ?? 0,
        }).eq('id', membership.facility_id),
      ]);
    }

    return NextResponse.json({ placeData, audit, facilityId: membership.facility_id });
  } catch (e) {
    console.error('[gbp/place] GET error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  // place_id を facility_profiles に保存
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { gbp_place_id, gbp_cid } = body;

  const { error } = await supabase
    .from('facility_profiles')
    .update({
      gbp_place_id: gbp_place_id || null,
      gbp_cid: gbp_cid || null,
      gbp_connected_at: gbp_place_id ? new Date().toISOString() : null,
    })
    .eq('id', membership.facility_id);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

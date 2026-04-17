import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { fetchPlaceDetails, calculateGbpScore } from '@/lib/gbp';

export async function GET(req: NextRequest) {
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

  // 施設プロフィール取得
  const { data: facility } = await supabase
    .from('facility_profiles')
    .select('gbp_place_id, name, description, phone, website_url, business_hours, main_photo_url')
    .eq('id', membership.facility_id)
    .single();

  if (!facility) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const placeId = req.nextUrl.searchParams.get('placeId') || facility.gbp_place_id;

  // Places API からデータ取得
  const placeData = placeId ? await fetchPlaceDetails(placeId) : null;

  // スコア計算
  const audit = calculateGbpScore(placeData, facility);

  // キャッシュ保存
  if (placeData) {
    await supabase.from('gbp_audit_cache').upsert({
      facility_id: membership.facility_id,
      score: audit.score,
      details: { audit, placeData },
      fetched_at: new Date().toISOString(),
    });
  }

  return NextResponse.json({ placeData, audit, facilityId: membership.facility_id });
}

export async function POST(req: NextRequest) {
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

  const body = await req.json();
  const { gbp_place_id, gbp_cid } = body;

  const { error } = await supabase
    .from('facility_profiles')
    .update({
      gbp_place_id: gbp_place_id || null,
      gbp_cid: gbp_cid || null,
      gbp_connected_at: gbp_place_id ? new Date().toISOString() : null,
    })
    .eq('id', membership.facility_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

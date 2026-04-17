/**
 * パーソナライズ推薦 API
 * GET /api/recommendations?limit=6
 * ユーザーの予約履歴・お気に入りから同タイプ・同エリアの施設を推薦
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ recommendations: [] });

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? '6'), 12);
  const excludeId = request.nextUrl.searchParams.get('exclude');

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 予約履歴から業種・エリアを取得
  const { data: bookings } = await admin
    .from('bookings')
    .select('facility_id, facility_profiles(id, business_type, prefecture, city)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  // お気に入りから取得
  const { data: favorites } = await admin
    .from('favorites')
    .select('facility_id, facility_profiles(id, business_type, prefecture, city)')
    .eq('user_id', user.id)
    .limit(20);

  // 業種・エリアの出現頻度をカウント
  const typeCount: Record<string, number> = {};
  const prefCityCount: Record<string, number> = {};
  const visitedIds = new Set<string>();

  const processEntry = (entry: { facility_id: string; facility_profiles: unknown }) => {
    const p = entry.facility_profiles as { id: string; business_type: string; prefecture: string; city: string } | null;
    if (!p) return;
    visitedIds.add(p.id);
    typeCount[p.business_type] = (typeCount[p.business_type] ?? 0) + 1;
    const key = `${p.prefecture}:${p.city}`;
    prefCityCount[key] = (prefCityCount[key] ?? 0) + 1;
  };

  for (const b of bookings ?? []) processEntry(b as { facility_id: string; facility_profiles: unknown });
  for (const f of favorites ?? []) processEntry(f as { facility_id: string; facility_profiles: unknown });

  if (excludeId) visitedIds.add(excludeId);

  // 最も頻出の業種・エリアを取得
  const topType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topPrefCity = Object.entries(prefCityCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  const [topPref, topCity] = topPrefCity ? topPrefCity.split(':') : [null, null];

  if (!topType && !topPref) {
    // 履歴なし → 人気施設を返す
    const { data } = await admin
      .from('facility_card_view')
      .select('*')
      .eq('is_published', true)
      .order('rating_count', { ascending: false })
      .limit(limit);
    return NextResponse.json({ recommendations: data ?? [], type: 'popular' });
  }

  // 同タイプ + 同エリアの施設
  let query = admin
    .from('facility_card_view')
    .select('*')
    .eq('is_published', true);

  if (topType) query = query.eq('business_type', topType);
  if (topPref) query = query.eq('prefecture', topPref);

  const { data: typeAreaMatches } = await query.order('rating_avg', { ascending: false }).limit(limit * 2);

  // 訪問済みを除外してリミットまで取得
  const filtered = (typeAreaMatches ?? []).filter((f) => !visitedIds.has(f.id)).slice(0, limit);

  // 足りない場合は同タイプから補完
  if (filtered.length < limit && topType) {
    const { data: typeMatches } = await admin
      .from('facility_card_view')
      .select('*')
      .eq('is_published', true)
      .eq('business_type', topType)
      .order('rating_avg', { ascending: false })
      .limit(limit * 2);

    const extra = (typeMatches ?? []).filter((f) => !visitedIds.has(f.id) && !filtered.find((r) => r.id === f.id));
    filtered.push(...extra.slice(0, limit - filtered.length));
  }

  return NextResponse.json({
    recommendations: filtered,
    type: 'personalized',
    based_on: { business_type: topType, prefecture: topPref, city: topCity },
  });
}

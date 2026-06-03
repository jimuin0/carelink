import { cache } from 'react';
import { createServerSupabaseClient } from './supabase-server';
import type { Facility, FacilityCardData, FacilityMenu, FacilityPhoto, FacilityReview, SearchParams, ScheduleOverride } from '@/types';
import { cachedFetch } from './redis';

const PER_PAGE = 20;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Card list queries use facility_card_view (has computed min_price, max_price, menu_count, coupon_count, photo_count)
// Note: Supabase view queries return generic types, so `as unknown as FacilityCardData[]` casts are intentional.
const CARD_VIEW = 'facility_card_view';
const CARD_COLS = 'id, slug, name, business_type, catch_copy, prefecture, city, access_info, rating_avg, rating_count, google_rating, google_review_count, main_photo_url, min_price, max_price, menu_count, coupon_count, photo_count, business_hours, seat_count';

export async function searchFacilities(params: SearchParams) {
  const supabase = createServerSupabaseClient();
  const isGeoSearch = params.lat != null && params.lng != null;

  let query = supabase
    .from(CARD_VIEW)
    .select(isGeoSearch ? `${CARD_COLS}, latitude, longitude` : CARD_COLS, { count: isGeoSearch ? undefined : 'exact' })
    .eq('status', 'published');

  if (params.type) query = query.eq('business_type', params.type);
  if (params.prefecture) query = query.eq('prefecture', params.prefecture);
  if (params.city) query = query.eq('city', params.city);
  if (params.keyword) {
    // LIKE ワイルドカード(%_\)をエスケープし、さらに .or() の条件区切り , とグループ () を除去して
    // フィルタ注入を防ぐ（round5 #zod-2。v1/customers と同形の防御）。
    const escaped = params.keyword.slice(0, 100).replace(/[%_\\]/g, '\\$&').replace(/[,()]/g, '');
    query = query.or(
      `name.ilike.%${escaped}%,catch_copy.ilike.%${escaped}%,description.ilike.%${escaped}%,city.ilike.%${escaped}%,nearest_station.ilike.%${escaped}%`
    );
  }

  if (params.rating_min) query = query.gte('rating_avg', params.rating_min);
  if (params.price_min) query = query.gte('min_price', params.price_min);
  if (params.price_max) query = query.lte('max_price', params.price_max);
  if (params.features && params.features.length > 0) {
    for (const f of params.features) {
      query = query.contains('features', [f]);
    }
  }

  if (isGeoSearch) {
    // Use PostGIS ST_DWithin via RPC for server-side GPS search
    const { data, error } = await supabase.rpc('search_facilities_nearby', {
      user_lat: params.lat,
      user_lng: params.lng,
      radius_km: 10,
      type_filter: params.type || null,
      limit_count: 500,
    });
    const all = (data || []) as unknown as (FacilityCardData & { distance_km: number })[];
    const page = params.page || 1;
    const from = (page - 1) * PER_PAGE;
    return { facilities: all.slice(from, from + PER_PAGE) as FacilityCardData[], total: all.length, perPage: PER_PAGE, error };
  }

  if (params.sort === 'rating') {
    query = query.order('rating_avg', { ascending: false });
  } else if (params.sort === 'popular') {
    query = query.order('view_count', { ascending: false, nullsFirst: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const page = params.page || 1;
  const from = (page - 1) * PER_PAGE;
  query = query.range(from, from + PER_PAGE - 1);

  const { data, count, error } = await query;
  return { facilities: (data || []) as unknown as FacilityCardData[], total: count || 0, perPage: PER_PAGE, error };
}

export async function getPopularFacilities(limit = 6) {
  const cacheKey = `popular_facilities:${limit}`;
  try {
    const cached = await cachedFetch<FacilityCardData[]>(
      cacheKey,
      async () => {
        const supabase = createServerSupabaseClient();
        const { data } = await supabase
          .from(CARD_VIEW)
          .select(CARD_COLS)
          .eq('status', 'published')
          .order('rating_count', { ascending: false })
          .limit(limit);
        return (data || []) as FacilityCardData[];
      },
      600 // 10 min cache
    );
    return { facilities: cached, error: null };
  } catch {
    // Fallback without cache
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from(CARD_VIEW)
      .select(CARD_COLS)
      .eq('status', 'published')
      .order('rating_count', { ascending: false })
      .limit(limit);
    return { facilities: (data || []) as FacilityCardData[], error };
  }
}

// 広告枠: アクティブな上位表示施設を返す（検索1ページ目に差し込む用）
export async function getFeaturedFacilities(businessType?: string, area?: string): Promise<FacilityCardData[]> {
  const supabase = createServerSupabaseClient();
  const now = new Date().toISOString();

  let query = supabase
    .from('featured_slots')
    .select(`facility_id, slot_type, ${CARD_VIEW}(${CARD_COLS})`)
    .eq('is_active', true)
    .eq('slot_type', 'search_top')
    .lte('starts_at', now)
    .gte('ends_at', now)
    .limit(3);

  // type/area は検索ページの生URLクエリが渡る。.or() テンプレートへ直結するため、
  // 条件区切り , とグループ () を除去し長さも制限してフィルタ注入を防ぐ（round5 #zod-1）。
  const safeOrValue = (v: string) => v.slice(0, 50).replace(/[,()]/g, '');
  if (businessType) query = query.or(`business_type.eq.${safeOrValue(businessType)},business_type.is.null`);
  if (area) query = query.or(`area.eq.${safeOrValue(area)},area.is.null`);

  const { data } = await query;
  return (data || [])
    .map((row: { [key: string]: unknown }) => row[CARD_VIEW])
    .filter(Boolean) as FacilityCardData[];
}

export const getFacilityBySlug = cache(async (slug: string) => {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_profiles')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();
  return { facility: data as Facility | null, error };
});

export async function getFacilityMenus(facilityId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_menus')
    .select('*')
    .eq('facility_id', facilityId)
    .order('sort_order');
  return { menus: (data || []) as FacilityMenu[], error };
}

export async function getFacilityPhotos(facilityId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_photos')
    .select('*')
    .eq('facility_id', facilityId)
    // sort_order が同値（旧データ・複数 photo_type の共有空間）でも順序を決定的にする二次キー（管理GETと対称）
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  return { photos: (data || []) as FacilityPhoto[], error };
}

export async function getFacilityReviews(facilityId: string) {
  const supabase = createServerSupabaseClient();
  // `public_reviews` はSupabase型定義に含まれないビューのため
  // 同スキーマの `facility_reviews` にキャストしてSDKの型エラーを回避する。
  // データ型は末尾の `as FacilityReview[]` で保証する。
  const { data, error } = await supabase
    .from('public_reviews' as 'facility_reviews')
    .select('*')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false });
  return { reviews: (data || []) as FacilityReview[], error };
}

export async function getSimilarFacilities(facilityId: string, businessType: string, prefecture: string, limit = 4) {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from(CARD_VIEW)
    .select(CARD_COLS)
    .eq('status', 'published')
    .eq('business_type', businessType)
    .eq('prefecture', prefecture)
    .neq('id', facilityId)
    .order('rating_avg', { ascending: false })
    .limit(limit);
  return (data || []) as FacilityCardData[];
}

export async function getNearbyFacilities(facilityId: string, prefecture: string, city: string, limit = 4) {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from(CARD_VIEW)
    .select(CARD_COLS)
    .eq('status', 'published')
    .eq('prefecture', prefecture)
    .eq('city', city)
    .neq('id', facilityId)
    .order('rating_avg', { ascending: false })
    .limit(limit);
  return (data || []) as FacilityCardData[];
}

export async function getLatestFacilities(limit = 6) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from(CARD_VIEW)
    .select(CARD_COLS)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { facilities: (data || []) as FacilityCardData[], error };
}

// Check which facilities have availability on a given date/time
export async function getAvailableFacilityIds(
  facilityIds: string[],
  dateStr: string,
  timeSlot?: string
): Promise<Set<string>> {
  if (facilityIds.length === 0) return new Set();
  const supabase = createServerSupabaseClient();
  const dayOfWeek = new Date(dateStr).getDay(); // 0=Sun

  // 1. Get staff schedules for this day of week
  const { data: staffSchedules } = await supabase
    .from('staff_schedules')
    .select('staff_id, start_time, end_time')
    .eq('day_of_week', dayOfWeek);

  // 2. Get staff → facility mapping
  const { data: staffProfiles } = await supabase
    .from('staff_profiles')
    .select('id, facility_id')
    .eq('is_active', true)
    .in('facility_id', facilityIds);

  if (!staffProfiles || staffProfiles.length === 0) return new Set();

  const staffToFacility = new Map<string, string>();
  for (const sp of staffProfiles) {
    staffToFacility.set(sp.id, sp.facility_id);
  }
  const staffIds = staffProfiles.map((s) => s.id);

  // 3. Check schedule overrides (holidays)
  const { data: overrides } = await supabase
    .from('schedule_overrides')
    .select('staff_id, is_holiday, start_time, end_time')
    .eq('date', dateStr)
    .in('staff_id', staffIds);

  const holidayStaff = new Set<string>();
  const overrideMap = new Map<string, ScheduleOverride>();
  for (const o of overrides || []) {
    if (o.is_holiday) {
      holidayStaff.add(o.staff_id);
    } else {
      overrideMap.set(o.staff_id, o as ScheduleOverride);
    }
  }

  // 4. Get existing bookings for this date
  const { data: bookings } = await supabase
    .from('bookings')
    .select('staff_id, start_time, end_time')
    .eq('booking_date', dateStr)
    .in('status', ['pending', 'confirmed'])
    .in('facility_id', facilityIds);

  const staffBookings = new Map<string, { start: string; end: string }[]>();
  for (const b of bookings || []) {
    if (!b.staff_id) continue;
    const list = staffBookings.get(b.staff_id) || [];
    list.push({ start: b.start_time, end: b.end_time });
    staffBookings.set(b.staff_id, list);
  }

  // 5. Determine time range filter
  let filterStart: string | null = null;
  let filterEnd: string | null = null;
  if (timeSlot === 'morning') { filterStart = '09:00'; filterEnd = '12:00'; }
  else if (timeSlot === 'afternoon') { filterStart = '12:00'; filterEnd = '17:00'; }
  else if (timeSlot === 'evening') { filterStart = '17:00'; filterEnd = '23:00'; }

  // 6. Check each staff for availability
  const scheduleMap = new Map<string, { start: string; end: string }>();
  for (const s of staffSchedules || []) {
    scheduleMap.set(s.staff_id, { start: s.start_time, end: s.end_time });
  }

  const availableFacilities = new Set<string>();

  for (const staffId of staffIds) {
    if (holidayStaff.has(staffId)) continue;
    const facilityId = staffToFacility.get(staffId);
    if (!facilityId || availableFacilities.has(facilityId)) continue;

    // Determine working hours
    const override = overrideMap.get(staffId);
    const schedule = scheduleMap.get(staffId);
    const workStart = override?.start_time || schedule?.start;
    const workEnd = override?.end_time || schedule?.end;
    if (!workStart || !workEnd) continue;

    // Apply time filter
    if (filterStart && filterEnd) {
      if (workEnd <= filterStart || workStart >= filterEnd) continue;
    }

    // Check if at least one slot is free (simplified: if # bookings < working hours)
    const existingBookings = staffBookings.get(staffId) || [];
    const workMinutes = timeToMinutes(workEnd) - timeToMinutes(workStart);
    const bookedMinutes = existingBookings.reduce((sum, b) => sum + Math.max(0, timeToMinutes(b.end) - timeToMinutes(b.start)), 0);
    if (bookedMinutes < workMinutes) {
      availableFacilities.add(facilityId);
    }
  }

  return availableFacilities;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export async function getMonthlyBookingCounts(facilityIds: string[]): Promise<Record<string, number>> {
  if (facilityIds.length === 0) return {};
  const supabase = createServerSupabaseClient();
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const monthStart = `${year}-${month}-01`;
  const nextMonth = now.getMonth() + 2 > 12
    ? `${year + 1}-01-01`
    : `${year}-${String(now.getMonth() + 2).padStart(2, '0')}-01`;

  const { data } = await supabase
    .from('bookings')
    .select('facility_id')
    .in('facility_id', facilityIds)
    .in('status', ['pending', 'confirmed', 'completed'])
    .gte('booking_date', monthStart)
    .lt('booking_date', nextMonth);

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    counts[row.facility_id] = (counts[row.facility_id] || 0) + 1;
  }
  return counts;
}


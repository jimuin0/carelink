import { createServerSupabaseClient } from './supabase-server';
import type { Facility, FacilityCardData, FacilityMenu, FacilityPhoto, FacilityReview, SearchParams } from '@/types';

const PER_PAGE = 20;

export async function searchFacilities(params: SearchParams) {
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from('facility_card_view')
    .select(
      'id, slug, name, business_type, catch_copy, prefecture, city, access_info, rating_avg, rating_count, main_photo_url, min_price, max_price, menu_count, coupon_count, photo_count, business_hours, seat_count',
      { count: 'exact' }
    )
    .eq('status', 'published');

  if (params.type) query = query.eq('business_type', params.type);
  if (params.prefecture) query = query.eq('prefecture', params.prefecture);
  if (params.city) query = query.eq('city', params.city);
  if (params.keyword) {
    const escaped = params.keyword.slice(0, 100).replace(/[%_\\]/g, '\\$&');
    query = query.or(
      `name.ilike.%${escaped}%,catch_copy.ilike.%${escaped}%,description.ilike.%${escaped}%,city.ilike.%${escaped}%`
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
  return { facilities: (data || []) as FacilityCardData[], total: count || 0, perPage: PER_PAGE, error };
}

export async function getPopularFacilities(limit = 6) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_card_view')
    .select(
      'id, slug, name, business_type, catch_copy, prefecture, city, access_info, rating_avg, rating_count, main_photo_url, min_price, max_price, menu_count, coupon_count, photo_count, business_hours, seat_count'
    )
    .eq('status', 'published')
    .order('rating_count', { ascending: false })
    .limit(limit);
  return { facilities: (data || []) as FacilityCardData[], error };
}

export async function getFacilityBySlug(slug: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_profiles')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();
  return { facility: data as Facility | null, error };
}

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
    .order('sort_order');
  return { photos: (data || []) as FacilityPhoto[], error };
}

export async function getFacilityReviews(facilityId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_reviews')
    .select('*')
    .eq('facility_id', facilityId)
    .eq('status', 'published')
    .order('created_at', { ascending: false });
  return { reviews: (data || []) as FacilityReview[], error };
}

export async function getSimilarFacilities(facilityId: string, businessType: string, prefecture: string, limit = 4) {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('facility_card_view')
    .select(
      'id, slug, name, business_type, catch_copy, prefecture, city, access_info, rating_avg, rating_count, main_photo_url, min_price, max_price, menu_count, coupon_count, photo_count, business_hours, seat_count'
    )
    .eq('status', 'published')
    .eq('business_type', businessType)
    .eq('prefecture', prefecture)
    .neq('id', facilityId)
    .order('rating_avg', { ascending: false })
    .limit(limit);
  return (data || []) as FacilityCardData[];
}

export async function getLatestFacilities(limit = 6) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_card_view')
    .select(
      'id, slug, name, business_type, catch_copy, prefecture, city, access_info, rating_avg, rating_count, main_photo_url, min_price, max_price, menu_count, coupon_count, photo_count, business_hours, seat_count'
    )
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { facilities: (data || []) as FacilityCardData[], error };
}

export async function getLatestReviews(limit = 6) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('facility_reviews')
    .select('id, rating, comment, reviewer_name, created_at, facility_id')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!data || data.length === 0) return { reviews: [] as LatestReviewWithFacility[], error };

  // Fetch facility names for these reviews
  const facilityIds = Array.from(new Set(data.map((r) => r.facility_id)));
  const { data: facilities } = await supabase
    .from('facility_profiles')
    .select('id, name, slug')
    .in('id', facilityIds);

  const facilityMap = new Map((facilities || []).map((f) => [f.id, f]));

  const reviews = data.map((r) => ({
    ...r,
    facility_name: facilityMap.get(r.facility_id)?.name || '',
    facility_slug: facilityMap.get(r.facility_id)?.slug || '',
  }));

  return { reviews: reviews as LatestReviewWithFacility[], error };
}

export interface LatestReviewWithFacility {
  id: string;
  rating: number;
  comment: string | null;
  reviewer_name: string;
  created_at: string;
  facility_id: string;
  facility_name: string;
  facility_slug: string;
}

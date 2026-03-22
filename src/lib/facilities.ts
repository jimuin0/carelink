import { createServerSupabaseClient } from './supabase-server';
import type { Facility, FacilityCardData, FacilityMenu, FacilityPhoto, FacilityReview, SearchParams } from '@/types';

const PER_PAGE = 20;

export async function searchFacilities(params: SearchParams) {
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from('facility_profiles')
    .select(
      'id, slug, name, business_type, catch_copy, prefecture, city, access_info, rating_avg, rating_count, main_photo_url',
      { count: 'exact' }
    )
    .eq('status', 'published');

  if (params.type) query = query.eq('business_type', params.type);
  if (params.prefecture) query = query.eq('prefecture', params.prefecture);
  if (params.keyword) {
    const escaped = params.keyword.replace(/[%_\\]/g, '\\$&');
    query = query.or(
      `name.ilike.%${escaped}%,catch_copy.ilike.%${escaped}%,description.ilike.%${escaped}%,city.ilike.%${escaped}%`
    );
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

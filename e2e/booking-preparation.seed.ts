import type { SupabaseClient } from '@supabase/supabase-js';

/** Explicit synthetic facts, never inferred production opening hours/photos. */
export async function confirmSyntheticBookingPreparation(db: SupabaseClient, facilityId: string) {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000') {
    throw new Error('booking preparation seed requires the managed disposable HTTPS CI lifecycle');
  }
  const business_hours = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => [day, { open: '09:00', close: '20:00' }]),
  );
  const updated = await db.from('facility_profiles').update({ business_hours }).eq('id', facilityId).select('id');
  if (updated.error || updated.data?.length !== 1) throw new Error('synthetic booking hours setup failed');
  const photo = await db.from('facility_photos').insert({ facility_id: facilityId,
    photo_url: 'https://localhost:3000/icons/icon-192.png', photo_type: 'other' });
  if (photo.error) throw new Error('synthetic booking photo setup failed');
  const ready = await db.rpc('facility_booking_ready', { p_facility_id: facilityId });
  if (ready.error || ready.data !== true) throw new Error('synthetic facility did not satisfy actual booking readiness');
}

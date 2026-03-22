import { createServerSupabaseAuthClient } from './supabase-server-auth';
import type { FacilityMember, Booking, CustomerVisit } from '@/types';

export async function getUserFacilityMembership(): Promise<FacilityMember | null> {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('facility_members')
    .select('*')
    .eq('user_id', user.id)
    .single();

  return data as FacilityMember | null;
}

export async function getFacilityBookings(facilityId: string, options?: { status?: string; date?: string }): Promise<Booking[]> {
  const supabase = createServerSupabaseAuthClient();
  let query = supabase
    .from('bookings')
    .select('*')
    .eq('facility_id', facilityId)
    .order('booking_date', { ascending: false });

  if (options?.status) query = query.eq('status', options.status);
  if (options?.date) query = query.eq('booking_date', options.date);

  const { data } = await query;
  return (data ?? []) as Booking[];
}

export async function updateBookingStatus(bookingId: string, status: string): Promise<{ error: string | null }> {
  const supabase = createServerSupabaseAuthClient();
  const { error } = await supabase
    .from('bookings')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', bookingId);
  return { error: error?.message ?? null };
}

export async function getCustomerVisits(facilityId: string, email?: string): Promise<CustomerVisit[]> {
  const supabase = createServerSupabaseAuthClient();
  let query = supabase
    .from('customer_visits')
    .select('*')
    .eq('facility_id', facilityId)
    .order('visit_date', { ascending: false });

  if (email) query = query.eq('customer_email', email);

  const { data } = await query;
  return (data ?? []) as CustomerVisit[];
}

export async function getUniqueCustomers(facilityId: string): Promise<{ email: string; name: string; visit_count: number; last_visit: string }[]> {
  const supabase = createServerSupabaseAuthClient();
  const { data } = await supabase
    .from('customer_visits')
    .select('customer_email, customer_name, visit_date')
    .eq('facility_id', facilityId)
    .order('visit_date', { ascending: false });

  if (!data) return [];

  const map = new Map<string, { email: string; name: string; visit_count: number; last_visit: string }>();
  for (const row of data) {
    const existing = map.get(row.customer_email);
    if (existing) {
      existing.visit_count++;
    } else {
      map.set(row.customer_email, {
        email: row.customer_email,
        name: row.customer_name,
        visit_count: 1,
        last_visit: row.visit_date,
      });
    }
  }
  return Array.from(map.values());
}

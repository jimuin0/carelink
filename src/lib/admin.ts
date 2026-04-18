import { createServerSupabaseAuthClient } from './supabase-server-auth';
import type { CustomerVisit } from '@/types';

export async function getCustomerVisits(facilityId: string, email?: string): Promise<CustomerVisit[]> {
  const supabase = await createServerSupabaseAuthClient();
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
  const supabase = await createServerSupabaseAuthClient();
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

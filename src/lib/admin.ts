import { createServerSupabaseAuthClient } from './supabase-server-auth';
import { canonicalizeEmail } from './email-canonical';
import type { CustomerVisit } from '@/types';

export async function getCustomerVisits(facilityId: string, email?: string): Promise<CustomerVisit[]> {
  const supabase = await createServerSupabaseAuthClient();
  let query = supabase
    .from('customer_visits')
    .select('*')
    .eq('facility_id', facilityId)
    .order('visit_date', { ascending: false });

  // 同一人物の来店は email_canonical（Gmail 別名統合）で突合する。入力も canonicalizeEmail で揃える。
  if (email) query = query.eq('email_canonical', canonicalizeEmail(email));

  const { data } = await query;
  return (data ?? []) as CustomerVisit[];
}

export async function getUniqueCustomers(facilityId: string): Promise<{ email: string; name: string; visit_count: number; last_visit: string }[]> {
  const supabase = await createServerSupabaseAuthClient();
  const { data } = await supabase
    .from('customer_visits')
    .select('customer_email, email_canonical, customer_name, visit_date')
    .eq('facility_id', facilityId)
    .order('visit_date', { ascending: false });

  if (!data) return [];

  // 顧客の一意性は email_canonical で判定（Gmail 別名を同一人物に統合）。表示は原文(customer_email)を保持。
  const map = new Map<string, { email: string; name: string; visit_count: number; last_visit: string }>();
  for (const row of data) {
    const key = (row as { email_canonical?: string | null }).email_canonical || row.customer_email;
    const existing = map.get(key);
    if (existing) {
      existing.visit_count++;
    } else {
      map.set(key, {
        email: row.customer_email,
        name: row.customer_name,
        visit_count: 1,
        last_visit: row.visit_date,
      });
    }
  }
  return Array.from(map.values());
}

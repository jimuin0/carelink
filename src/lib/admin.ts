import { createServerSupabaseAuthClient } from './supabase-server-auth';
import { canonicalizeEmail } from './email-canonical';
import { isMissingColumnError, type DbError } from './db-fallback';
import type { CustomerVisit } from '@/types';

export async function getCustomerVisits(facilityId: string, email?: string): Promise<CustomerVisit[]> {
  const supabase = await createServerSupabaseAuthClient();
  const base = () => supabase
    .from('customer_visits')
    .select('*')
    .eq('facility_id', facilityId)
    .order('visit_date', { ascending: false });

  if (!email) {
    const { data } = await base();
    return (data ?? []) as CustomerVisit[];
  }

  // 同一人物の来店は email_canonical（Gmail 別名統合）で突合する。入力も canonicalizeEmail で揃える。
  // email_canonical 列が未適用(migration前)なら customer_email にフォールバックして壊さない（無破壊・順序非依存）。
  const firstTry = await base().eq('email_canonical', canonicalizeEmail(email));
  let data = firstTry.data;
  if (isMissingColumnError(firstTry.error as DbError | null)) {
    data = (await base().eq('customer_email', email)).data;
  }
  return (data ?? []) as CustomerVisit[];
}

export async function getUniqueCustomers(facilityId: string): Promise<{ email: string; name: string; visit_count: number; last_visit: string }[]> {
  const supabase = await createServerSupabaseAuthClient();
  const fetchWith = (cols: string) => supabase
    .from('customer_visits')
    .select(cols)
    .eq('facility_id', facilityId)
    .order('visit_date', { ascending: false });

  // email_canonical 列があればそれを識別キーに、無ければ customer_email を JS で canonical 化（無破壊・順序非依存）。
  const firstTry = await fetchWith('customer_email, email_canonical, customer_name, visit_date');
  let data = firstTry.data;
  let hasCanonicalColumn = true;
  if (isMissingColumnError(firstTry.error as DbError | null)) {
    data = (await fetchWith('customer_email, customer_name, visit_date')).data;
    hasCanonicalColumn = false;
  }

  if (!data) return [];

  // 顧客の一意性は canonical 値で判定（Gmail 別名を同一人物に統合）。表示は原文(customer_email)を保持。
  const map = new Map<string, { email: string; name: string; visit_count: number; last_visit: string }>();
  for (const r of data as unknown as { customer_email: string; email_canonical?: string | null; customer_name: string; visit_date: string }[]) {
    const key = hasCanonicalColumn ? (r.email_canonical || r.customer_email) : canonicalizeEmail(r.customer_email);
    const existing = map.get(key);
    if (existing) {
      existing.visit_count++;
    } else {
      map.set(key, {
        email: r.customer_email,
        name: r.customer_name,
        visit_count: 1,
        last_visit: r.visit_date,
      });
    }
  }
  return Array.from(map.values());
}

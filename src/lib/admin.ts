import { createServerSupabaseAuthClient } from './supabase-server-auth';
import { canonicalizeEmail } from './email-canonical';
import { isMissingColumnError, type DbError } from './db-fallback';
import type { CustomerVisit } from '@/types';
import { fetchAllPaged } from './paginate';
import { z } from 'zod';

type CustomerSummary = { email: string; name: string; visit_count: number | string; last_visit: string };
type VisitIdentity = { customer_email: string | null; email_canonical?: string | null; customer_name: string; visit_date: string };
type VisitIdentityColumns = 'customer_email, email_canonical, customer_name, visit_date' | 'customer_email, customer_name, visit_date';
const visitIdentities = z.array(z.object({ customer_email:z.string().nullable(), email_canonical:z.string().nullable().optional(),
  customer_name:z.string(), visit_date:z.string().min(1) }));
const customerSummaries = z.array(z.object({ email: z.string().min(1), name: z.string(),
  visit_count: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)),
  last_visit: z.string().min(1) }));

async function readAll<T>(fetchPage: (offset: number, limit: number) => Promise<{ data: T[] | null; error: unknown }>) {
  return fetchAllPaged(fetchPage, { failOnTruncation: true });
}

export async function getCustomerVisits(facilityId: string, email?: string): Promise<CustomerVisit[]> {
  const supabase = await createServerSupabaseAuthClient();
  const base = () => supabase
    .from('customer_visits')
    .select('*')
    .eq('facility_id', facilityId)
    .order('visit_date', { ascending: false }).order('id');

  const fetch = (column?: string, value?: string) => readAll<CustomerVisit>(async (offset, limit) => {
    const query = column ? base().eq(column, value!) : base();
    const result = await query.range(offset, offset + limit - 1);
    return { data: result.data, error: result.error || (!Array.isArray(result.data) ? new Error('visit result invalid') : null) };
  });

  if (!email) {
    const { rows, error } = await fetch();
    if (error) throw new Error('来店履歴の取得に失敗しました');
    return rows;
  }

  // 同一人物の来店は email_canonical（Gmail 別名統合）で突合する。入力も canonicalizeEmail で揃える。
  // email_canonical 列が未適用(migration前)なら customer_email にフォールバックして壊さない（無破壊・順序非依存）。
  const firstTry = await fetch('email_canonical', canonicalizeEmail(email));
  let data = firstTry.rows;
  if (isMissingColumnError(firstTry.error as DbError | null)) {
    const fallback = await fetch('customer_email', email);
    if (fallback.error) throw new Error('来店履歴の取得に失敗しました');
    data = fallback.rows;
  } else if (firstTry.error) {
    throw new Error('来店履歴の取得に失敗しました');
  }
  return data;
}

export async function getUniqueCustomers(facilityId: string): Promise<{ email: string; name: string; visit_count: number; last_visit: string }[]> {
  const supabase = await createServerSupabaseAuthClient();

  // まず DB 集計 RPC を試す（全来店行の転送・JS 集計を避ける）。
  // RPC 未適用（PGRST202）やエラー時は従来の JS 集計へフォールバックするため、
  // migration 適用前後どちらでも正しく動作する（症状ブロックでなく漸進的移行）。
  const { rows: rpcData, error: rpcError } = await readAll<CustomerSummary>(async (offset, limit) => {
      const result = await supabase.rpc('get_unique_customers', { p_facility_id: facilityId })
        .range(offset, offset + limit - 1);
      // Malformed provider data is not a measured empty list.
      return { data: Array.isArray(result.data) ? result.data : null,
        error: result.error || (!Array.isArray(result.data) ? new Error('customer RPC result invalid') : null) };
    });
  const parsed = customerSummaries.safeParse(rpcData);
  if (!rpcError && parsed.success) return parsed.data;

  const fetchWith = (cols: VisitIdentityColumns) => supabase
    .from('customer_visits')
    .select(cols)
    .eq('facility_id', facilityId)
    .order('visit_date', { ascending: false }).order('id');
  const fetch = (cols: VisitIdentityColumns) => readAll<VisitIdentity>(async (offset, limit) => {
    const result = await fetchWith(cols).range(offset, offset + limit - 1);
    const identities = visitIdentities.safeParse(result.data);
    return { data: identities.success ? identities.data : null,
      error: result.error || (identities.success ? null : new Error('customer visits invalid')) };
  });

  // email_canonical 列があればそれを識別キーに、無ければ customer_email を JS で canonical 化（無破壊・順序非依存）。
  const firstTry = await fetch('customer_email, email_canonical, customer_name, visit_date');
  let data = firstTry.rows;
  let hasCanonicalColumn = true;
  if (isMissingColumnError(firstTry.error as DbError | null)) {
    const fallback = await fetch('customer_email, customer_name, visit_date');
    if (fallback.error) throw new Error('顧客集計の取得に失敗しました');
    data = fallback.rows;
    hasCanonicalColumn = false;
  } else if (firstTry.error) {
    throw new Error('顧客集計の取得に失敗しました');
  }

  // 顧客の一意性は canonical 値で判定（Gmail 別名を同一人物に統合）。表示は原文(customer_email)を保持。
  const map = new Map<string, { email: string; name: string; visit_count: number; last_visit: string }>();
  for (const r of data) {
    // Email-less phone bookings remain separate booking histories. Do not
    // merge unrelated people into one null key or manufacture an identity.
    if (!r.customer_email?.trim()) continue;
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

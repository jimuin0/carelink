import { createServerSupabaseAuthClient } from './supabase-server-auth';
import { canonicalizeEmail } from './email-canonical';
import { customerIdentityKey, phoneDigits, PHONE_KEY_PREFIX } from './customer-identity';
import { isMissingColumnError, type DbError } from './db-fallback';
import type { CustomerVisit } from '@/types';
import { fetchAllPaged } from './paginate';
import type { CustomerVisitSummary } from './customer-directory';
import { z } from 'zod';

const visitCount = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER));
const customerSummaries = z.array(z.object({
  email: z.string().nullable(), phone: z.string().nullable(), name: z.string(),
  visit_count: visitCount, last_visit: z.string().min(1),
}));
// 予備の経路（集計 RPC が使えないとき）で読む来店行。電話番号は予約から引く。
const visitIdentities = z.array(z.object({
  customer_email: z.string().nullable(), customer_name: z.string(), visit_date: z.string().min(1),
  booking: z.object({ phone: z.string().nullable() }).nullable(),
}));
type VisitIdentity = z.infer<typeof visitIdentities>[number];
type VisitWithBooking = CustomerVisit & { booking: { phone: string | null } | null };

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

/**
 * 電話番号で台帳に登録したお客様（メール無し）の来店履歴。メールの無い来店のうち、
 * 予約の電話番号が一致するものだけを返す。電話番号が識別に使えない（空・10 桁未満）ときは
 * 1 件も照会しない（施設の全来店を返さない）。
 */
export async function getCustomerPhoneVisits(facilityId: string, phone: string | null | undefined): Promise<CustomerVisit[]> {
  const digits = phoneDigits(phone);
  if (!digits) return [];
  const supabase = await createServerSupabaseAuthClient();

  const viaRpc = await readAll<CustomerVisit>(async (offset, limit) => {
    const result = await supabase.rpc('get_customer_phone_visits', { p_facility_id: facilityId, p_phone: digits })
      .range(offset, offset + limit - 1);
    return { data: Array.isArray(result.data) ? result.data : null,
      error: result.error || (!Array.isArray(result.data) ? new Error('phone visit RPC result invalid') : null) };
  });
  if (!viaRpc.error) return viaRpc.rows;

  // RPC 未適用（migration 前）などで使えないときは、予約に紐づく来店を読んで同じ規則で絞る。
  const fallback = await readAll<VisitWithBooking>(async (offset, limit) => {
    const result = await supabase
      .from('customer_visits')
      .select('*, booking:bookings(phone)')
      .eq('facility_id', facilityId)
      .not('booking_id', 'is', null)
      .order('visit_date', { ascending: false }).order('id')
      .range(offset, offset + limit - 1);
    return { data: result.data, error: result.error || (!Array.isArray(result.data) ? new Error('visit result invalid') : null) };
  });
  if (fallback.error) throw new Error('来店履歴の取得に失敗しました');
  const key = `${PHONE_KEY_PREFIX}${digits}`;
  return fallback.rows
    .filter((v) => customerIdentityKey(v.customer_email, v.booking?.phone) === key)
    .map(({ booking: _booking, ...visit }) => visit);
}

export async function getUniqueCustomers(facilityId: string): Promise<CustomerVisitSummary[]> {
  const supabase = await createServerSupabaseAuthClient();

  // まず DB 集計 RPC を試す（全来店行の転送・JS 集計を避ける）。
  // RPC 未適用（PGRST202）やエラー時は JS 集計へフォールバックするため、
  // migration 適用前後どちらでも同じ結果になる（症状ブロックでなく漸進的移行）。
  const { rows: rpcData, error: rpcError } = await readAll<unknown>(async (offset, limit) => {
      const result = await supabase.rpc('get_customer_visit_summary', { p_facility_id: facilityId })
        .range(offset, offset + limit - 1);
      // Malformed provider data is not a measured empty list.
      return { data: Array.isArray(result.data) ? result.data : null,
        error: result.error || (!Array.isArray(result.data) ? new Error('customer RPC result invalid') : null) };
    });
  const parsed = customerSummaries.safeParse(rpcData);
  if (!rpcError && parsed.success) {
    // メールも電話番号も無い行は誰とも突合できない（RPC はそもそも返さない）。
    return parsed.data.filter((row) => customerIdentityKey(row.email, row.phone) !== null);
  }

  const { rows: data, error } = await readAll<VisitIdentity>(async (offset, limit) => {
    const result = await supabase
      .from('customer_visits')
      .select('customer_email, customer_name, visit_date, booking:bookings(phone)')
      .eq('facility_id', facilityId)
      .order('visit_date', { ascending: false }).order('id')
      .range(offset, offset + limit - 1);
    const identities = visitIdentities.safeParse(result.data);
    return { data: identities.success ? identities.data : null,
      error: result.error || (identities.success ? null : new Error('customer visits invalid')) };
  });
  if (error) throw new Error('顧客集計の取得に失敗しました');

  // 顧客の一意性は customerIdentityKey で判定（Gmail 別名を同一人物に統合・メールが無ければ電話番号）。
  // 表示は最も新しい来店の原文を保持する（来店は新しい順に読んでいる）。
  const map = new Map<string, CustomerVisitSummary>();
  for (const r of data) {
    const phone = r.booking?.phone ?? null;
    // メールも電話番号も無い来店は別々の予約履歴のまま。名前で別の人をまとめない。
    const key = customerIdentityKey(r.customer_email, phone);
    if (!key) continue;
    const existing = map.get(key);
    if (existing) {
      existing.visit_count++;
    } else {
      map.set(key, {
        email: r.customer_email?.trim() ? r.customer_email : null,
        phone,
        name: r.customer_name,
        visit_count: 1,
        last_visit: r.visit_date,
      });
    }
  }
  return Array.from(map.values());
}

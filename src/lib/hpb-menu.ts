/**
 * HPB メニュー取得値の DB 操作(hpb_menu_durations)。
 *
 * - 生の取得値(name/target/duration_min/price/description)は再取得で上書きする。
 * - 管理画面での手直し(*_override) と is_hidden は upsert payload に含めないため、
 *   既存行では温存される(上書き保護)。新規行は DB デフォルト(override=NULL / is_hidden=false)。
 * - 不完全行(name無 / duration<=0 / price<=0)はスキップ(取得失敗を実データに上書きしない・保全)。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchStoreRows, httpFetch, type FetchFn } from './hpb-scraper';
import type { HpbMenuRow } from '@/types/hpb';

const TABLE = 'hpb_menu_durations';

/** facility の HPB 店舗ID(hpb_sln_id)を取得。未設定/空白/不在は null。 */
export async function getFacilitySlnId(
  admin: SupabaseClient,
  facilityId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('facility_profiles')
    .select('hpb_sln_id')
    .eq('id', facilityId)
    .maybeSingle();
  const sln = data?.hpb_sln_id;
  return typeof sln === 'string' && sln.trim() ? sln.trim() : null;
}

/**
 * 取得行を hpb_menu_durations に upsert(facility_id,ref_id 衝突キー)。
 * 生の取得値のみ書き込み、手直し列(*_override)と is_hidden は含めない(既存行で温存=上書き保護)。
 * 不完全行はスキップ。Returns: { ok, skipped, failed }。
 */
export async function saveHpbRows(
  admin: SupabaseClient,
  facilityId: string,
  rows: HpbMenuRow[],
): Promise<{ ok: number; skipped: number; failed: number }> {
  let skipped = 0;
  const payload = [];
  for (const r of rows) {
    if (!r.name || r.durationMin <= 0 || r.price <= 0) {
      skipped++;
      continue;
    }
    payload.push({
      facility_id: facilityId,
      ref_id: r.refId,
      kind: r.kind,
      store_id: r.storeId,
      name: r.name,
      target: r.target,
      duration_min: r.durationMin,
      price: r.price,
      description: r.description,
    });
  }
  if (payload.length === 0) return { ok: 0, skipped, failed: 0 };
  const { error } = await admin
    .from(TABLE)
    .upsert(payload, { onConflict: 'facility_id,ref_id' });
  if (error) return { ok: 0, skipped, failed: payload.length };
  return { ok: payload.length, skipped, failed: 0 };
}

/** 1施設をスクレイプして保存。hpb_sln_id 未設定なら何もせず slnId=null を返す。 */
export async function scrapeAndSaveFacility(
  admin: SupabaseClient,
  facilityId: string,
  fetchFn: FetchFn = httpFetch,
): Promise<{
  slnId: string | null;
  fetched: number;
  ok: number;
  skipped: number;
  failed: number;
}> {
  const slnId = await getFacilitySlnId(admin, facilityId);
  if (!slnId) return { slnId: null, fetched: 0, ok: 0, skipped: 0, failed: 0 };
  const rows = await fetchStoreRows(slnId, fetchFn);
  const saved = await saveHpbRows(admin, facilityId, rows);
  return { slnId, fetched: rows.length, ...saved };
}

/** 管理画面用: facility の HPB メニュー一覧(手直し列含む)。エラー時 null。 */
export async function listHpbMenus(
  admin: SupabaseClient,
  facilityId: string,
): Promise<HpbMenuDurationRow[] | null> {
  const { data, error } = await admin
    .from(TABLE)
    .select('*')
    .eq('facility_id', facilityId)
    .order('kind', { ascending: true })
    .order('name', { ascending: true });
  if (error) return null;
  return data as HpbMenuDurationRow[];
}

/** hpb_menu_durations 1行(DB スキーマ。手直し列含む)。 */
export interface HpbMenuDurationRow {
  facility_id: string;
  ref_id: string;
  kind: string;
  store_id: string;
  name: string;
  target: string | null;
  duration_min: number | null;
  price: number | null;
  description: string | null;
  name_override: string | null;
  duration_min_override: number | null;
  price_override: number | null;
  description_override: string | null;
  is_hidden: boolean;
  updated_at: string;
  created_at: string;
}

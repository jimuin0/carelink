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

/**
 * facility の HPB 店舗ID(hpb_sln_id)を設定。空/nullで未設定に戻す。
 * Returns: 成功 true / DB エラー false。
 */
export async function setFacilitySlnId(
  admin: SupabaseClient,
  facilityId: string,
  slnId: string | null,
): Promise<boolean> {
  const { error } = await admin
    .from('facility_profiles')
    .update({ hpb_sln_id: slnId, updated_at: new Date().toISOString() })
    .eq('id', facilityId);
  return !error;
}

/**
 * 管理画面の手直し(*_override / is_hidden)を1行に反映(facility_id,ref_id 指定)。
 * 生の取得値(name/duration_min/price/description)は触らない=再取得で消えない手直し層。
 * Returns: { ok, notFound }。ok=更新成功 / notFound=該当行なし / 両 false=DB エラー。
 */
export async function updateHpbMenuOverride(
  admin: SupabaseClient,
  facilityId: string,
  refId: string,
  patch: HpbMenuOverridePatch,
): Promise<{ ok: boolean; notFound: boolean }> {
  const { data, error } = await admin
    .from(TABLE)
    .update(patch)
    .eq('facility_id', facilityId)
    .eq('ref_id', refId)
    .select('ref_id')
    .maybeSingle();
  if (error) return { ok: false, notFound: false };
  if (!data) return { ok: false, notFound: true };
  return { ok: true, notFound: false };
}

/** 管理画面で書き換える手直し列(部分更新)。 */
export interface HpbMenuOverridePatch {
  name_override?: string | null;
  duration_min_override?: number | null;
  price_override?: number | null;
  description_override?: string | null;
  is_hidden?: boolean;
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

/** 反映時に facility_menus.category に入れる固定値(HPB に category 概念が無いため)。後から管理画面で編集可。 */
export const HPB_APPLIED_CATEGORY = 'メニュー';

/** override 優先の実効値(管理画面の手直しが取得値より優先)。 */
function effectiveValues(row: HpbMenuDurationRow): {
  name: string;
  duration: number | null;
  price: number | null;
  description: string | null;
} {
  return {
    name: row.name_override ?? row.name,
    duration: row.duration_min_override ?? row.duration_min,
    price: row.price_override ?? row.price,
    description: row.description_override ?? row.description,
  };
}

/** facility_menus への一括反映結果。 */
export interface ApplyHpbResult {
  inserted: number; // 新規作成(非公開で作成)
  updated: number; // 既存 HPB 由来メニューの値を更新
  hidden: number; // is_hidden により紐付く既存メニューを非公開化
  skipped: number; // name が空で反映対象外
}

/**
 * hpb_menu_durations を facility_menus へ反映(同期)。再反映で二重作成しない(hpb_ref_id 紐付け)。
 * - is_hidden=false: override 適用後の値で facility_menus を更新(既存) or 新規作成。
 *   新規は category='メニュー'・is_published=false(非公開=下書き)で作成→管理画面で公開ON。
 *   既存行は値列(name/price/duration_minutes/description)のみ更新し、
 *   is_published(神原の公開判断)・category・sort_order は温存(上書きしない)。
 * - is_hidden=true: 紐付く facility_menus 行があれば is_published=false(客から隠す)。
 * - name(override後)が空の行はスキップ(不完全データを実メニューに流さない)。
 * DB エラー時は Error を throw(呼び出し側で 500)。再実行は冪等(hpb_ref_id で既存判定)。
 */
export async function applyHpbMenusToFacilityMenus(
  admin: SupabaseClient,
  facilityId: string,
): Promise<ApplyHpbResult> {
  const hpbRows = await listHpbMenus(admin, facilityId);
  if (hpbRows === null) throw new Error('listHpbMenus failed');

  // 既存の HPB 由来 facility_menus を hpb_ref_id で索引(手入力メニューは hpb_ref_id=null で対象外)。
  const refIds = hpbRows.map((r) => r.ref_id);
  const existingByRef = new Map<string, string>();
  if (refIds.length > 0) {
    const { data, error } = await admin
      .from('facility_menus')
      .select('id, hpb_ref_id')
      .eq('facility_id', facilityId)
      .in('hpb_ref_id', refIds);
    if (error) throw new Error('facility_menus read failed');
    for (const r of (data ?? []) as { id: string; hpb_ref_id: string | null }[]) {
      if (r.hpb_ref_id) existingByRef.set(r.hpb_ref_id, r.id);
    }
  }

  let inserted = 0;
  let updated = 0;
  let hidden = 0;
  let skipped = 0;
  const toInsert: Record<string, unknown>[] = [];

  for (const row of hpbRows) {
    const existingId = existingByRef.get(row.ref_id);
    if (row.is_hidden) {
      if (existingId) {
        const { error } = await admin
          .from('facility_menus')
          .update({ is_published: false })
          .eq('id', existingId);
        if (error) throw new Error('hide update failed');
        hidden++;
      }
      continue;
    }
    const e = effectiveValues(row);
    if (!e.name.trim()) {
      skipped++;
      continue;
    }
    if (existingId) {
      const { error } = await admin
        .from('facility_menus')
        .update({
          name: e.name,
          price: e.price,
          duration_minutes: e.duration,
          description: e.description,
        })
        .eq('id', existingId);
      if (error) throw new Error('value update failed');
      updated++;
    } else {
      toInsert.push({
        facility_id: facilityId,
        hpb_ref_id: row.ref_id,
        category: HPB_APPLIED_CATEGORY,
        name: e.name,
        price: e.price,
        duration_minutes: e.duration,
        description: e.description,
        is_published: false,
      });
    }
  }

  if (toInsert.length > 0) {
    const { error } = await admin.from('facility_menus').insert(toInsert);
    if (error) throw new Error('insert failed');
    inserted = toInsert.length;
  }

  return { inserted, updated, hidden, skipped };
}

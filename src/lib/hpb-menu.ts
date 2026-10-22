/**
 * HPB メニュー取得値の DB 操作(hpb_menu_durations)。
 *
 * - 生の取得値(name/target/duration_min/price/description)は再取得で上書きする。
 * - 管理画面での手直し(*_override) と is_hidden は upsert payload に含めないため、
 *   既存行では温存される(上書き保護)。新規行は DB デフォルト(override=NULL / is_hidden=false)。
 * - 不完全行(name無 / duration<=0 / price<=0)はスキップ(取得失敗を実データに上書きしない・保全)。
 * - 最後まで取得できたときだけ、今回の取得に無かった行へ missing_since を付ける(HPB で掲載終了・
 *   別の店舗IDで取得した行)。再び取得できた行は upsert で missing_since を NULL に戻す。
 * - お客様メニュー(facility_menus)への一括反映は「まだ無いメニューを作るだけ」(2026年10月23日)。
 *   既にあるメニューは変更せず、クーポン・掲載終了・別の店舗IDの行は作らない。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchStoreRows, httpFetch, type FetchFn } from './hpb-scraper';
import type { HpbFetchStopReason, HpbMenuRow } from '@/types/hpb';

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
  return normalizeSlnId(data?.hpb_sln_id);
}

/** hpb_sln_id の値を店舗IDとして読む(空白以外を含む文字列だけ・前後の空白は除く)。 */
function normalizeSlnId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 取得行を hpb_menu_durations に upsert(facility_id,ref_id 衝突キー)。
 * 生の取得値のみ書き込み、手直し列(*_override)・is_hidden・applied_at は含めない(既存行で温存=上書き保護)。
 * 取得できた行は HPB に在るので missing_since を NULL に戻す(掲載終了の印を外す)。
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
      missing_since: null,
    });
  }
  if (payload.length === 0) return { ok: 0, skipped, failed: 0 };
  const { error } = await admin
    .from(TABLE)
    .upsert(payload, { onConflict: 'facility_id,ref_id' });
  if (error) return { ok: 0, skipped, failed: payload.length };
  return { ok: payload.length, skipped, failed: 0 };
}

/**
 * 最後まで取得できたときだけ呼ぶ: 今回の取得(seenRefIds)に無かった行へ missing_since を付ける。
 * 既に印のある行はそのまま(最初に見つからなくなった時刻を保つ)。取得は店舗ID(slnId)で行うため、
 * 別の店舗IDで取得した古い行も今回の取得には無く、ここで印が付く。
 * seenRefIds が空なら何もしない(空の取得結果を根拠に全行を「掲載終了」にしない)。
 * Returns: 新しく印を付けた件数 / DB エラーは null。
 */
export async function markMissingHpbRows(
  admin: SupabaseClient,
  facilityId: string,
  seenRefIds: string[],
): Promise<number | null> {
  if (seenRefIds.length === 0) return 0;
  const { data, error } = await admin
    .from(TABLE)
    .select('ref_id')
    .eq('facility_id', facilityId)
    .is('missing_since', null);
  if (error) return null;
  const seen = new Set(seenRefIds);
  const gone = ((data ?? []) as { ref_id: string }[])
    .map((r) => r.ref_id)
    .filter((refId) => !seen.has(refId));
  if (gone.length === 0) return 0;
  const { error: markError } = await admin
    .from(TABLE)
    .update({ missing_since: new Date().toISOString() })
    .eq('facility_id', facilityId)
    .in('ref_id', gone);
  if (markError) return null;
  return gone.length;
}

/**
 * 1施設をスクレイプして保存。hpb_sln_id 未設定なら何もせず slnId=null を返す。
 * 最後まで取得・保存できたときだけ、取得に無かった行へ「掲載終了」の印を付ける(missing)。
 * 途中で止まった取得(時間切れ・取得失敗・HTML 不正)では印を付けない(一晩の不調で全行を外さない)。
 * 印付けに失敗したら missingCheckFailed=true・complete=false(古い行が残るため失敗として扱う)。
 */
export async function scrapeAndSaveFacility(
  admin: SupabaseClient,
  facilityId: string,
  fetchFn: FetchFn = httpFetch,
  deadlineAt?: number,
): Promise<{
  slnId: string | null;
  fetched: number;
  ok: number;
  skipped: number;
  failed: number;
  saveFailed: number;
  complete: boolean;
  stopReason: HpbFetchStopReason | null;
  discoveredItems: number;
  unresolvedItems: number;
  failedPages: number;
  missing: number;
  missingCheckFailed: boolean;
}> {
  const slnId = await getFacilitySlnId(admin, facilityId);
  if (!slnId) return {
    slnId: null, fetched: 0, ok: 0, skipped: 0, failed: 0, saveFailed: 0,
    complete: false, stopReason: null, discoveredItems: 0, unresolvedItems: 0, failedPages: 0,
    missing: 0, missingCheckFailed: false,
  };
  const fetched = await fetchStoreRows(slnId, fetchFn, 12, deadlineAt);
  const saved = await saveHpbRows(admin, facilityId, fetched.rows);
  let missing = 0;
  let missingCheckFailed = false;
  if (fetched.complete && saved.failed === 0) {
    const marked = await markMissingHpbRows(admin, facilityId, fetched.rows.map((r) => r.refId));
    if (marked === null) missingCheckFailed = true;
    else missing = marked;
  }
  const failed = saved.failed + fetched.unresolvedItems + (missingCheckFailed ? 1 : 0) + (
    !fetched.complete && saved.failed === 0 && fetched.unresolvedItems === 0 ? 1 : 0
  );
  return {
    slnId,
    fetched: fetched.rows.length,
    ...saved,
    failed,
    saveFailed: saved.failed,
    complete: fetched.complete && saved.failed === 0 && !missingCheckFailed,
    stopReason: fetched.stopReason,
    discoveredItems: fetched.discoveredItems,
    unresolvedItems: fetched.unresolvedItems,
    failedPages: fetched.failedPages,
    missing,
    missingCheckFailed,
  };
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
  /** 最後まで取得できたのに HPB に無かった時刻(掲載終了・別の店舗IDで取得した行)。NULL＝HPB にある。 */
  missing_since: string | null;
  /** 一括反映でお客様メニューを作った時刻。NULL＝まだ作っていない。 */
  applied_at: string | null;
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
  inserted: number; // 新規作成(非公開＝下書きで作成)
  existing: number; // 既にお客様メニューにあるため変更しなかった
  hidden: number; // is_hidden により紐付く既存メニューを非公開化
  skipped: number; // name(手直し後)が空で作らなかった
  coupons: number; // クーポン(新規・再来などの対象条件と割引価格を引き継げないため作らない)
  ended: number; // HPB で掲載終了(最後まで取得できた最新の取得に無かった)
  other_store: number; // 今の店舗ID(hpb_sln_id)とは別の店舗IDで取得した行(店舗ID未設定を含む)
  deleted: number; // 以前作ったメニューがメニュー管理で削除済み(作り直さない)
}

/**
 * hpb_menu_durations から、お客様メニュー(facility_menus)に【まだ無いメニューだけ】を作る。
 * 再反映で二重作成しない(hpb_ref_id 紐付け + applied_at)。DB エラー時は Error を throw(呼び出し側で 500)。
 *
 * 行ごとの扱い(上から順に判定):
 * - is_hidden=true: 紐付く facility_menus 行があれば is_published=false(客から隠す)。管理画面での明示の指示。
 * - store_id が今の店舗IDと違う: 作らない(誤った店舗IDで取得した別の店舗の行・店舗ID未設定)。
 * - missing_since あり: 作らない(HPB で掲載終了)。既に作ったメニューは変更しない(扱うかはお店が決める)。
 * - kind=coupon: 作らない。HPB のクーポンは新規・再来などの対象条件と利用条件付きの割引価格で、
 *   通常メニューにすると誰でもその価格で予約できてしまう(条件は facility_menus に持てない)。
 *   下書きで作る案は、メニュー管理の「非公開のメニューをすべて公開する」でまとめて公開され得るため採らない。
 * - 紐付く facility_menus 行がある: 変更しない(名前・料金・時間・説明はメニュー管理での手直しを優先)。
 *   以前の反映で applied_at が無い行はここで記録する(この後に削除されても作り直さないため)。
 * - applied_at あり(以前作ったのに紐付く行が無い): メニュー管理で削除済みなので作り直さない。
 * - name(手直し後)が空: スキップ(不完全データを実メニューに流さない)。
 * - それ以外: category='メニュー'・is_published=false(非公開=下書き)で作成し、applied_at を記録。
 */
export async function applyHpbMenusToFacilityMenus(
  admin: SupabaseClient,
  facilityId: string,
): Promise<ApplyHpbResult> {
  // 今の店舗IDを確かめられないまま反映しない(読み取り失敗を「未設定」と取り違えない)。
  const { data: profile, error: profileError } = await admin
    .from('facility_profiles')
    .select('hpb_sln_id')
    .eq('id', facilityId)
    .maybeSingle();
  if (profileError) throw new Error('facility_profiles read failed');
  const currentSlnId = normalizeSlnId(profile?.hpb_sln_id);

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

  const result: ApplyHpbResult = {
    inserted: 0, existing: 0, hidden: 0, skipped: 0, coupons: 0, ended: 0, other_store: 0, deleted: 0,
  };
  const toInsert: Record<string, unknown>[] = [];
  const appliedRefIds: string[] = [];

  for (const row of hpbRows) {
    const existingId = existingByRef.get(row.ref_id);
    if (row.is_hidden) {
      if (existingId) {
        const { error } = await admin
          .from('facility_menus')
          .update({ is_published: false })
          .eq('id', existingId);
        if (error) throw new Error('hide update failed');
        result.hidden++;
      }
      continue;
    }
    if (row.store_id !== currentSlnId) {
      result.other_store++;
      continue;
    }
    if (row.missing_since) {
      result.ended++;
      continue;
    }
    if (row.kind !== 'menu') {
      result.coupons++;
      continue;
    }
    if (existingId) {
      result.existing++;
      if (!row.applied_at) appliedRefIds.push(row.ref_id);
      continue;
    }
    if (row.applied_at) {
      result.deleted++;
      continue;
    }
    const e = effectiveValues(row);
    if (!e.name.trim()) {
      result.skipped++;
      continue;
    }
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
    appliedRefIds.push(row.ref_id);
  }

  if (toInsert.length > 0) {
    const { error } = await admin.from('facility_menus').insert(toInsert);
    if (error) throw new Error('insert failed');
    result.inserted = toInsert.length;
  }

  // 作ったメニュー(と以前の反映で記録が無かったもの)に applied_at を記録する。ここで失敗しても、
  // 作ったメニューは紐付き(hpb_ref_id)で次回「既にある」と判定されるので二重作成にはならない。
  if (appliedRefIds.length > 0) {
    const { error } = await admin
      .from(TABLE)
      .update({ applied_at: new Date().toISOString() })
      .eq('facility_id', facilityId)
      .in('ref_id', appliedRefIds);
    if (error) throw new Error('applied mark failed');
  }

  return result;
}

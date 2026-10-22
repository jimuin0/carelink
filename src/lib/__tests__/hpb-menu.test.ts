/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/hpb-menu.ts
 * getFacilitySlnId / saveHpbRows / markMissingHpbRows / scrapeAndSaveFacility / listHpbMenus /
 * applyHpbMenusToFacilityMenus を網羅(branches100%)。
 *
 * 2026年10月23日: 一括反映は「まだ無いメニューを作るだけ」になった。
 *   - HPB のクーポン(新規・再来など対象条件つきの割引価格)はお客様メニューにしない
 *   - 既にあるメニュー(メニュー管理で手直し済み)は上書きしない・削除済みは作り直さない
 *   - HPB で掲載終了・別の店舗IDで取得した行は作らない(取得時に missing_since で印を付ける)
 */

jest.mock('../hpb-scraper', () => ({
  fetchStoreRows: jest.fn(),
  httpFetch: jest.fn(),
}));

import {
  getFacilitySlnId,
  saveHpbRows,
  markMissingHpbRows,
  scrapeAndSaveFacility,
  listHpbMenus,
  setFacilitySlnId,
  updateHpbMenuOverride,
  applyHpbMenusToFacilityMenus,
  HPB_APPLIED_CATEGORY,
  type HpbMenuDurationRow,
} from '../hpb-menu';
import { fetchStoreRows } from '../hpb-scraper';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HpbMenuRow } from '@/types/hpb';

const FACILITY = '22222222-2222-2222-2222-222222222222';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function asAdmin(from: jest.Mock): SupabaseClient {
  return { from } as unknown as SupabaseClient;
}

function profileChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data, error }),
  };
}

function upsertChain(error: unknown) {
  return { upsert: jest.fn().mockResolvedValue({ error }) };
}

function menuListChain(data: unknown, error: unknown = null) {
  const second = { order: jest.fn().mockResolvedValue({ data, error }) };
  const first = { order: jest.fn().mockReturnValue(second) };
  return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(first) }) };
}

/** markMissingHpbRows の読み取り: select('ref_id').eq('facility_id').is('missing_since', null) */
function presentRowsChain(data: unknown, error: unknown = null) {
  const is = jest.fn().mockResolvedValue({ data, error });
  const eq = jest.fn().mockReturnValue({ is });
  return { chain: { select: jest.fn().mockReturnValue({ eq }) }, eq, is };
}

/** markMissingHpbRows の書き込み: update({missing_since}).eq('facility_id').in('ref_id', gone) */
function markChain(error: unknown = null) {
  const inFn = jest.fn().mockResolvedValue({ error });
  const eq = jest.fn().mockReturnValue({ in: inFn });
  return { chain: { update: jest.fn().mockReturnValue({ eq }) }, eq, in: inFn };
}

function validRow(over: Partial<HpbMenuRow> = {}): HpbMenuRow {
  return {
    refId: 'CP1',
    kind: 'coupon',
    storeId: 'H1',
    name: 'メニューA',
    target: '全員',
    durationMin: 70,
    price: 6900,
    description: '説明',
    ...over,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('getFacilitySlnId', () => {
  test('returns trimmed sln when present', async () => {
    const from = jest.fn().mockReturnValue(profileChain({ hpb_sln_id: '  H000537368 ' }));
    expect(await getFacilitySlnId(asAdmin(from), FACILITY)).toBe('H000537368');
  });
  test('returns null when row missing', async () => {
    const from = jest.fn().mockReturnValue(profileChain(null));
    expect(await getFacilitySlnId(asAdmin(from), FACILITY)).toBeNull();
  });
  test('returns null when sln is empty string', async () => {
    const from = jest.fn().mockReturnValue(profileChain({ hpb_sln_id: '' }));
    expect(await getFacilitySlnId(asAdmin(from), FACILITY)).toBeNull();
  });
  test('returns null when sln is whitespace', async () => {
    const from = jest.fn().mockReturnValue(profileChain({ hpb_sln_id: '   ' }));
    expect(await getFacilitySlnId(asAdmin(from), FACILITY)).toBeNull();
  });
  test('returns null when sln is non-string (undefined column)', async () => {
    const from = jest.fn().mockReturnValue(profileChain({}));
    expect(await getFacilitySlnId(asAdmin(from), FACILITY)).toBeNull();
  });
});

describe('saveHpbRows', () => {
  test('upserts valid rows, preserves overrides and the applied mark, clears the missing mark', async () => {
    const chain = upsertChain(null);
    const from = jest.fn().mockReturnValue(chain);
    const res = await saveHpbRows(asAdmin(from), FACILITY, [validRow(), validRow({ refId: 'CP2' })]);
    expect(res).toEqual({ ok: 2, skipped: 0, failed: 0 });
    const payload = chain.upsert.mock.calls[0][0];
    expect(chain.upsert.mock.calls[0][1]).toEqual({ onConflict: 'facility_id,ref_id' });
    expect(Object.keys(payload[0])).not.toContain('name_override');
    expect(Object.keys(payload[0])).not.toContain('is_hidden');
    // 反映済みの記録は取得し直しても消さない(消すと削除済みのメニューが作り直される)。
    expect(Object.keys(payload[0])).not.toContain('applied_at');
    // 取得できた行は HPB にあるので「掲載終了」の印を外す。
    expect(payload[0].missing_since).toBeNull();
    expect(payload[0].facility_id).toBe(FACILITY);
  });
  test('skips incomplete rows (no name / dur<=0 / price<=0)', async () => {
    const chain = upsertChain(null);
    const from = jest.fn().mockReturnValue(chain);
    const rows = [
      validRow(),
      validRow({ refId: 'X1', name: '' }),
      validRow({ refId: 'X2', durationMin: 0 }),
      validRow({ refId: 'X3', price: 0 }),
    ];
    const res = await saveHpbRows(asAdmin(from), FACILITY, rows);
    expect(res).toEqual({ ok: 1, skipped: 3, failed: 0 });
  });
  test('all incomplete → no upsert call', async () => {
    const chain = upsertChain(null);
    const from = jest.fn().mockReturnValue(chain);
    const res = await saveHpbRows(asAdmin(from), FACILITY, [validRow({ name: '' })]);
    expect(res).toEqual({ ok: 0, skipped: 1, failed: 0 });
    expect(chain.upsert).not.toHaveBeenCalled();
  });
  test('upsert error → failed', async () => {
    const from = jest.fn().mockReturnValue(upsertChain({ message: 'db' }));
    const res = await saveHpbRows(asAdmin(from), FACILITY, [validRow()]);
    expect(res).toEqual({ ok: 0, skipped: 0, failed: 1 });
  });
});

describe('markMissingHpbRows', () => {
  test('marks only the rows that the complete fetch did not contain', async () => {
    const present = presentRowsChain([{ ref_id: 'CP1' }, { ref_id: 'CP-ENDED' }, { ref_id: 'CP-OTHER-STORE' }]);
    const mark = markChain();
    const from = jest.fn().mockReturnValueOnce(present.chain).mockReturnValueOnce(mark.chain);
    expect(await markMissingHpbRows(asAdmin(from), FACILITY, ['CP1', 'CP2'])).toBe(2);
    expect(from).toHaveBeenNthCalledWith(1, 'hpb_menu_durations');
    expect(present.eq).toHaveBeenCalledWith('facility_id', FACILITY);
    expect(present.is).toHaveBeenCalledWith('missing_since', null);
    expect(from).toHaveBeenNthCalledWith(2, 'hpb_menu_durations');
    expect(mark.chain.update).toHaveBeenCalledWith({ missing_since: expect.stringMatching(ISO) });
    expect(mark.eq).toHaveBeenCalledWith('facility_id', FACILITY);
    expect(mark.in).toHaveBeenCalledWith('ref_id', ['CP-ENDED', 'CP-OTHER-STORE']);
  });
  test('an empty fetch never marks every row as gone', async () => {
    const from = jest.fn();
    expect(await markMissingHpbRows(asAdmin(from), FACILITY, [])).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });
  test('nothing gone → no update', async () => {
    const present = presentRowsChain([{ ref_id: 'CP1' }]);
    const from = jest.fn().mockReturnValueOnce(present.chain);
    expect(await markMissingHpbRows(asAdmin(from), FACILITY, ['CP1'])).toBe(0);
    expect(from).toHaveBeenCalledTimes(1);
  });
  test('null data is treated as no rows', async () => {
    const present = presentRowsChain(null);
    const from = jest.fn().mockReturnValueOnce(present.chain);
    expect(await markMissingHpbRows(asAdmin(from), FACILITY, ['CP1'])).toBe(0);
    expect(from).toHaveBeenCalledTimes(1);
  });
  test('read error → null', async () => {
    const present = presentRowsChain(null, { message: 'db' });
    const from = jest.fn().mockReturnValueOnce(present.chain);
    expect(await markMissingHpbRows(asAdmin(from), FACILITY, ['CP1'])).toBeNull();
  });
  test('update error → null', async () => {
    const present = presentRowsChain([{ ref_id: 'CP-ENDED' }]);
    const mark = markChain({ message: 'db' });
    const from = jest.fn().mockReturnValueOnce(present.chain).mockReturnValueOnce(mark.chain);
    expect(await markMissingHpbRows(asAdmin(from), FACILITY, ['CP1'])).toBeNull();
  });
});

describe('scrapeAndSaveFacility', () => {
  test('sln not set → no scrape (default fetchFn branch)', async () => {
    const from = jest.fn().mockReturnValue(profileChain(null));
    const res = await scrapeAndSaveFacility(asAdmin(from), FACILITY);
    expect(res).toEqual({
      slnId: null, fetched: 0, ok: 0, skipped: 0, failed: 0, saveFailed: 0,
      complete: false, stopReason: null, discoveredItems: 0, unresolvedItems: 0, failedPages: 0,
      missing: 0, missingCheckFailed: false,
    });
    expect(fetchStoreRows).not.toHaveBeenCalled();
  });
  test('complete fetch → saves, then marks the rows HPB no longer lists (explicit fetchFn branch)', async () => {
    const present = presentRowsChain([{ ref_id: 'CP1' }, { ref_id: 'CP2' }, { ref_id: 'CP-ENDED' }]);
    const mark = markChain();
    const from = jest
      .fn()
      .mockReturnValueOnce(profileChain({ hpb_sln_id: 'H1' }))
      .mockReturnValueOnce(upsertChain(null))
      .mockReturnValueOnce(present.chain)
      .mockReturnValueOnce(mark.chain);
    (fetchStoreRows as jest.Mock).mockResolvedValue({
      rows: [validRow(), validRow({ refId: 'CP2' })], complete: true, stopReason: 'normal_end',
      discoveredItems: 2, unresolvedItems: 0, failedPages: 0, listingComplete: true, listedRefIds: ['CP1', 'CP2'],
    });
    const customFetch = jest.fn();
    const res = await scrapeAndSaveFacility(asAdmin(from), FACILITY, customFetch);
    expect(res).toEqual({
      slnId: 'H1', fetched: 2, ok: 2, skipped: 0, failed: 0, saveFailed: 0,
      complete: true, stopReason: 'normal_end', discoveredItems: 2, unresolvedItems: 0, failedPages: 0,
      missing: 1, missingCheckFailed: false,
    });
    expect(fetchStoreRows).toHaveBeenCalledWith('H1', customFetch, 12, undefined);
    expect(mark.in).toHaveBeenCalledWith('ref_id', ['CP-ENDED']);
  });

  test('partial fetch still saves valid rows, remains incomplete and never marks rows as gone', async () => {
    const from = jest.fn()
      .mockReturnValueOnce(profileChain({ hpb_sln_id: 'H1' }))
      .mockReturnValueOnce(upsertChain(null));
    (fetchStoreRows as jest.Mock).mockResolvedValue({
      rows: [validRow()], complete: false, stopReason: 'fetch_error',
      discoveredItems: 2, unresolvedItems: 1, failedPages: 1, listingComplete: false, listedRefIds: ['CP1', 'CP2'],
    });
    const result = await scrapeAndSaveFacility(asAdmin(from), FACILITY, jest.fn());
    expect(result).toMatchObject({
      fetched: 1, ok: 1, failed: 1, complete: false, stopReason: 'fetch_error', missing: 0, missingCheckFailed: false,
    });
    // 一覧を最後まで読めなかった取得を根拠に、残りの行を「掲載終了」にしない。
    expect(from).toHaveBeenCalledTimes(2);
  });

  // 以前は「予約ページを全部読めた」ときだけ印を付けていたため、価格0・所要時間なしなどで毎回読めない
  // 項目が 1 件でもある店舗では、HPB で終わったメニューに印が永久に付かず一括反映の対象に残り続けた。
  test('一覧を最後まで読めたなら、予約ページを読めない項目があっても一覧に無い行へ印を付ける', async () => {
    const present = presentRowsChain([{ ref_id: 'CP1' }, { ref_id: 'CP-UNRESOLVED' }, { ref_id: 'MN-ENDED' }]);
    const mark = markChain();
    const from = jest.fn()
      .mockReturnValueOnce(profileChain({ hpb_sln_id: 'H1' }))
      .mockReturnValueOnce(upsertChain(null))
      .mockReturnValueOnce(present.chain)
      .mockReturnValueOnce(mark.chain);
    (fetchStoreRows as jest.Mock).mockResolvedValue({
      rows: [validRow()], complete: false, stopReason: 'invalid_html',
      discoveredItems: 2, unresolvedItems: 1, failedPages: 0,
      listingComplete: true, listedRefIds: ['CP1', 'CP-UNRESOLVED'],
    });
    const result = await scrapeAndSaveFacility(asAdmin(from), FACILITY, jest.fn());
    // 一覧にあった項目(読めなかったものも)は HPB にあるので印を付けない。一覧に無い行だけに付ける。
    expect(mark.in).toHaveBeenCalledWith('ref_id', ['MN-ENDED']);
    expect(result).toMatchObject({
      fetched: 1, ok: 1, failed: 1, complete: false, stopReason: 'invalid_html', missing: 1, missingCheckFailed: false,
    });
  });

  test('一覧は最後まで読めたが予約ページの途中で時間切れでも、一覧に無い行へは印を付ける', async () => {
    const present = presentRowsChain([{ ref_id: 'CP1' }, { ref_id: 'CP-LATER' }, { ref_id: 'MN-ENDED' }]);
    const mark = markChain();
    const from = jest.fn()
      .mockReturnValueOnce(profileChain({ hpb_sln_id: 'H1' }))
      .mockReturnValueOnce(upsertChain(null))
      .mockReturnValueOnce(present.chain)
      .mockReturnValueOnce(mark.chain);
    (fetchStoreRows as jest.Mock).mockResolvedValue({
      rows: [validRow()], complete: false, stopReason: 'time_budget',
      discoveredItems: 2, unresolvedItems: 1, failedPages: 0,
      listingComplete: true, listedRefIds: ['CP1', 'CP-LATER'],
    });
    const result = await scrapeAndSaveFacility(asAdmin(from), FACILITY, jest.fn());
    expect(mark.in).toHaveBeenCalledWith('ref_id', ['MN-ENDED']);
    expect(result).toMatchObject({ complete: false, stopReason: 'time_budget', missing: 1 });
  });

  test('incomplete empty fetch still reports a failure when no item-level error explains it', async () => {
    const from = jest.fn()
      .mockReturnValueOnce(profileChain({ hpb_sln_id: 'H1' }))
      .mockReturnValueOnce(upsertChain(null));
    (fetchStoreRows as jest.Mock).mockResolvedValue({
      rows: [], complete: false, stopReason: 'time_budget',
      discoveredItems: 0, unresolvedItems: 0, failedPages: 0, listingComplete: false, listedRefIds: [],
    });
    const result = await scrapeAndSaveFacility(asAdmin(from), FACILITY, jest.fn());
    expect(result).toMatchObject({ fetched: 0, failed: 1, complete: false, stopReason: 'time_budget', missing: 0 });
    // 店舗IDの読み取りだけ(0 件なので保存も、掲載終了の印付けもしない)。
    expect(from).toHaveBeenCalledTimes(1);
  });

  test('complete fetch plus database failure remains an incomplete saved result and marks nothing', async () => {
    const from = jest.fn()
      .mockReturnValueOnce(profileChain({ hpb_sln_id: 'H1' }))
      .mockReturnValueOnce(upsertChain({ message: 'db failure' }));
    (fetchStoreRows as jest.Mock).mockResolvedValue({
      rows: [validRow()], complete: true, stopReason: 'normal_end',
      discoveredItems: 1, unresolvedItems: 0, failedPages: 0, listingComplete: true, listedRefIds: ['CP1'],
    });
    const result = await scrapeAndSaveFacility(asAdmin(from), FACILITY, jest.fn());
    expect(result).toMatchObject({ fetched: 1, ok: 0, failed: 1, saveFailed: 1, complete: false, missing: 0 });
    expect(from).toHaveBeenCalledTimes(2);
  });

  test('a failure while marking gone rows makes the run a failure (stale rows would stay reflectable)', async () => {
    const present = presentRowsChain(null, { message: 'db' });
    const from = jest.fn()
      .mockReturnValueOnce(profileChain({ hpb_sln_id: 'H1' }))
      .mockReturnValueOnce(upsertChain(null))
      .mockReturnValueOnce(present.chain);
    (fetchStoreRows as jest.Mock).mockResolvedValue({
      rows: [validRow()], complete: true, stopReason: 'normal_end',
      discoveredItems: 1, unresolvedItems: 0, failedPages: 0, listingComplete: true, listedRefIds: ['CP1'],
    });
    const result = await scrapeAndSaveFacility(asAdmin(from), FACILITY, jest.fn());
    expect(result).toMatchObject({
      ok: 1, saveFailed: 0, failed: 1, complete: false, missing: 0, missingCheckFailed: true,
    });
  });
});

function updateChain(error: unknown) {
  return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error }) }) };
}

function overrideUpdateChain(data: unknown, error: unknown = null) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error });
  // update().eq().eq().select().maybeSingle()
  const chain = {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    maybeSingle,
  };
  return chain;
}

describe('setFacilitySlnId', () => {
  test('returns true on success', async () => {
    const from = jest.fn().mockReturnValue(updateChain(null));
    expect(await setFacilitySlnId(asAdmin(from), FACILITY, 'H1')).toBe(true);
  });
  test('returns false on db error', async () => {
    const from = jest.fn().mockReturnValue(updateChain({ message: 'db' }));
    expect(await setFacilitySlnId(asAdmin(from), FACILITY, null)).toBe(false);
  });
});

describe('updateHpbMenuOverride', () => {
  test('ok when row updated', async () => {
    const from = jest.fn().mockReturnValue(overrideUpdateChain({ ref_id: 'CP1' }));
    expect(await updateHpbMenuOverride(asAdmin(from), FACILITY, 'CP1', { is_hidden: true }))
      .toEqual({ ok: true, notFound: false });
  });
  test('notFound when no row matched', async () => {
    const from = jest.fn().mockReturnValue(overrideUpdateChain(null));
    expect(await updateHpbMenuOverride(asAdmin(from), FACILITY, 'CP1', { name_override: 'x' }))
      .toEqual({ ok: false, notFound: true });
  });
  test('db error → both false', async () => {
    const from = jest.fn().mockReturnValue(overrideUpdateChain(null, { message: 'db' }));
    expect(await updateHpbMenuOverride(asAdmin(from), FACILITY, 'CP1', { price_override: 100 }))
      .toEqual({ ok: false, notFound: false });
  });
});

describe('listHpbMenus', () => {
  test('returns rows on success', async () => {
    const from = jest.fn().mockReturnValue(menuListChain([{ ref_id: 'CP1' }]));
    const res = await listHpbMenus(asAdmin(from), FACILITY);
    expect(res).toEqual([{ ref_id: 'CP1' }]);
  });
  test('returns null on error', async () => {
    const from = jest.fn().mockReturnValue(menuListChain(null, { message: 'db' }));
    expect(await listHpbMenus(asAdmin(from), FACILITY)).toBeNull();
  });
});

// ─── applyHpbMenusToFacilityMenus ───
/** 既定は「今の店舗ID(H1)で取得し、HPB にあり、まだ反映していない通常メニュー」。 */
function hpbRow(over: Partial<HpbMenuDurationRow> = {}): HpbMenuDurationRow {
  return {
    facility_id: FACILITY,
    ref_id: 'MN1',
    kind: 'menu',
    store_id: 'H1',
    name: 'メニューA',
    target: null,
    duration_min: 70,
    price: 6900,
    description: '説明',
    name_override: null,
    duration_min_override: null,
    price_override: null,
    description_override: null,
    is_hidden: false,
    missing_since: null,
    applied_at: null,
    updated_at: '',
    created_at: '',
    ...over,
  };
}

const EMPTY_RESULT = {
  inserted: 0, existing: 0, hidden: 0, skipped: 0, coupons: 0, coupons_in_menus: 0, ended: 0, other_store: 0, deleted: 0,
};

interface ApplyOpts {
  hpbRows: HpbMenuDurationRow[] | null;
  hpbError?: unknown;
  profile?: unknown;
  profileError?: unknown;
  existing?: { id: string; hpb_ref_id: string | null }[] | null;
  existingError?: unknown;
  updateErrors?: unknown[];
  insertError?: unknown;
  appliedError?: unknown;
}

function makeApplyAdmin(o: ApplyOpts) {
  const updateQueue = [...(o.updateErrors ?? [])];
  const insert = jest.fn().mockResolvedValue({ error: o.insertError ?? null });
  const updateEq = jest.fn().mockImplementation(() =>
    Promise.resolve({ error: updateQueue.length ? updateQueue.shift() : null }),
  );
  const fm = {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({ data: o.existing ?? null, error: o.existingError ?? null }),
      }),
    }),
    update: jest.fn().mockReturnValue({ eq: updateEq }),
    insert,
  };
  // hpb_menu_durations: 一覧(select…order…order) と applied_at の記録(update().eq().in())
  const appliedIn = jest.fn().mockResolvedValue({ error: o.appliedError ?? null });
  const appliedEq = jest.fn().mockReturnValue({ in: appliedIn });
  const hpbUpdate = jest.fn().mockReturnValue({ eq: appliedEq });
  const profile = profileChain(o.profile === undefined ? { hpb_sln_id: 'H1' } : o.profile, o.profileError ?? null);
  const from = jest.fn((table: string) => {
    if (table === 'facility_profiles') return profile;
    if (table === 'hpb_menu_durations') return { ...menuListChain(o.hpbRows, o.hpbError ?? null), update: hpbUpdate };
    return fm;
  });
  return { admin: asAdmin(from), fm, insert, updateEq, hpbUpdate, appliedEq, appliedIn };
}

describe('applyHpbMenusToFacilityMenus', () => {
  test('店舗IDの読み取りエラー → throw(未設定と取り違えて反映しない)', async () => {
    const { admin, insert } = makeApplyAdmin({ hpbRows: [hpbRow()], profileError: { message: 'db' } });
    await expect(applyHpbMenusToFacilityMenus(admin, FACILITY)).rejects.toThrow('facility_profiles read failed');
    expect(insert).not.toHaveBeenCalled();
  });

  test('listHpbMenus が null → throw', async () => {
    const { admin } = makeApplyAdmin({ hpbRows: null, hpbError: { message: 'db' } });
    await expect(applyHpbMenusToFacilityMenus(admin, FACILITY)).rejects.toThrow('listHpbMenus failed');
  });

  test('行ゼロ → 何もせず 0 件', async () => {
    const { admin, insert, hpbUpdate } = makeApplyAdmin({ hpbRows: [] });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual(EMPTY_RESULT);
    expect(insert).not.toHaveBeenCalled();
    expect(hpbUpdate).not.toHaveBeenCalled();
  });

  test('facility_menus 読み取りエラー → throw', async () => {
    const { admin } = makeApplyAdmin({ hpbRows: [hpbRow()], existingError: { message: 'db' } });
    await expect(applyHpbMenusToFacilityMenus(admin, FACILITY)).rejects.toThrow('facility_menus read failed');
  });

  test('まだ無いメニュー → is_published=false / category=メニュー で作り、反映済みを記録する', async () => {
    const { admin, insert, hpbUpdate, appliedEq, appliedIn } = makeApplyAdmin({ hpbRows: [hpbRow()], existing: [] });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, inserted: 1 });
    expect(insert).toHaveBeenCalledWith([
      {
        facility_id: FACILITY,
        hpb_ref_id: 'MN1',
        category: HPB_APPLIED_CATEGORY,
        name: 'メニューA',
        price: 6900,
        duration_minutes: 70,
        description: '説明',
        is_published: false,
      },
    ]);
    expect(hpbUpdate).toHaveBeenCalledWith({ applied_at: expect.stringMatching(ISO) });
    expect(appliedEq).toHaveBeenCalledWith('facility_id', FACILITY);
    expect(appliedIn).toHaveBeenCalledWith('ref_id', ['MN1']);
  });

  test('手直し(override)は新しく作るメニューに使う', async () => {
    const { admin, insert } = makeApplyAdmin({
      hpbRows: [hpbRow({ name_override: 'X', duration_min_override: 80, price_override: 5000, description_override: 'D' })],
      existing: [],
    });
    await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({
      name: 'X', price: 5000, duration_minutes: 80, description: 'D',
    })]);
  });

  test('existing が null でも空配列扱いで insert', async () => {
    const { admin, insert } = makeApplyAdmin({ hpbRows: [hpbRow()], existing: null });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res.inserted).toBe(1);
    expect(insert).toHaveBeenCalled();
  });

  test('hpb_ref_id null の既存行は索引に入れず新規扱い', async () => {
    const { admin, insert } = makeApplyAdmin({
      hpbRows: [hpbRow()],
      existing: [{ id: 'm1', hpb_ref_id: null }],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res.inserted).toBe(1);
    expect(insert).toHaveBeenCalled();
  });

  test('insert エラー → throw(反映済みは記録しない)', async () => {
    const { admin, hpbUpdate } = makeApplyAdmin({ hpbRows: [hpbRow()], existing: [], insertError: { message: 'db' } });
    await expect(applyHpbMenusToFacilityMenus(admin, FACILITY)).rejects.toThrow('insert failed');
    expect(hpbUpdate).not.toHaveBeenCalled();
  });

  test('反映済みの記録に失敗 → throw', async () => {
    const { admin, insert } = makeApplyAdmin({ hpbRows: [hpbRow()], existing: [], appliedError: { message: 'db' } });
    await expect(applyHpbMenusToFacilityMenus(admin, FACILITY)).rejects.toThrow('applied mark failed');
    expect(insert).toHaveBeenCalled();
  });

  // D11: 以前は既存行の name/price/duration_minutes/description を毎回 HPB の値で update していた。
  test('既にあるメニューは変更しない(メニュー管理での手直しを HPB の値で戻さない)', async () => {
    const { admin, fm, insert, appliedIn } = makeApplyAdmin({
      hpbRows: [hpbRow({ price: 4400, description: null, applied_at: '2026-10-01T00:00:00.000Z' })],
      existing: [{ id: 'm1', hpb_ref_id: 'MN1' }],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, existing: 1 });
    expect(fm.update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(appliedIn).not.toHaveBeenCalled();
  });

  test('以前の反映で記録が無い既存メニューは、変更せずに反映済みだけ記録する', async () => {
    const { admin, fm, appliedIn } = makeApplyAdmin({
      hpbRows: [hpbRow()],
      existing: [{ id: 'm1', hpb_ref_id: 'MN1' }],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, existing: 1 });
    expect(fm.update).not.toHaveBeenCalled();
    expect(appliedIn).toHaveBeenCalledWith('ref_id', ['MN1']);
  });

  test('以前作ったメニューをメニュー管理で削除していたら作り直さない', async () => {
    const { admin, insert } = makeApplyAdmin({
      hpbRows: [hpbRow({ applied_at: '2026-10-01T00:00:00.000Z' })],
      existing: [],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, deleted: 1 });
    expect(insert).not.toHaveBeenCalled();
  });

  // D10: 以前は HPB の新規限定クーポンが割引価格の通常メニューとして作られ、誰でも予約できた。
  test.each(['新規', '既存', '全員', '?'])('クーポン(対象:%s)はお客様メニューにしない', async (target) => {
    const { admin, insert, fm } = makeApplyAdmin({
      hpbRows: [hpbRow({ ref_id: 'CP1', kind: 'coupon', target, price: 3980 })],
      existing: [],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, coupons: 1 });
    expect(insert).not.toHaveBeenCalled();
    expect(fm.update).not.toHaveBeenCalled();
  });

  // D12: 以前は HPB で掲載終了した行・別の店舗IDで取得した行も毎回反映していた。
  test('HPB で掲載終了した行は作らず、既に作ったメニューも変更しない', async () => {
    const { admin, insert, fm } = makeApplyAdmin({
      hpbRows: [
        hpbRow({ ref_id: 'MN-ENDED', missing_since: '2026-10-20T00:00:00.000Z' }),
        hpbRow({ ref_id: 'MN-ENDED-LINKED', missing_since: '2026-10-20T00:00:00.000Z' }),
      ],
      existing: [{ id: 'm1', hpb_ref_id: 'MN-ENDED-LINKED' }],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, ended: 2 });
    expect(insert).not.toHaveBeenCalled();
    expect(fm.update).not.toHaveBeenCalled();
  });

  test('紐付くメニューがあるのに記録が無い行は、作らない行でも反映済みとして記録する', async () => {
    const { admin, insert, fm, appliedIn } = makeApplyAdmin({
      hpbRows: [
        hpbRow({ ref_id: 'MN-ENDED-LINKED', missing_since: '2026-10-20T00:00:00.000Z' }),
        hpbRow({ ref_id: 'MN-OTHER-LINKED', store_id: 'H999' }),
        hpbRow({ ref_id: 'MN-HIDDEN-LINKED', is_hidden: true }),
        hpbRow({ ref_id: 'MN-ENDED-RECORDED', missing_since: '2026-10-20T00:00:00.000Z', applied_at: '2026-10-01T00:00:00.000Z' }),
      ],
      existing: [
        { id: 'm1', hpb_ref_id: 'MN-ENDED-LINKED' },
        { id: 'm2', hpb_ref_id: 'MN-OTHER-LINKED' },
        { id: 'm3', hpb_ref_id: 'MN-HIDDEN-LINKED' },
        { id: 'm4', hpb_ref_id: 'MN-ENDED-RECORDED' },
      ],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, ended: 2, other_store: 1, hidden: 1 });
    expect(insert).not.toHaveBeenCalled();
    expect(fm.update).toHaveBeenCalledTimes(1); // 非表示の 1 件を非公開にするだけ
    expect(appliedIn).toHaveBeenCalledWith('ref_id', ['MN-ENDED-LINKED', 'MN-OTHER-LINKED', 'MN-HIDDEN-LINKED']);
  });

  // この修正より前の反映でクーポンから作られたお客様メニュー(割引価格・条件なし)を黙って見逃さない。
  // 以前は「クーポン」として数えるだけで、反映済みの記録も無く、画面には「反映対象外」と出ていた。
  test('クーポンなのに紐付くお客様メニューがある → 変更せず別に数え、反映済みとして記録する', async () => {
    const { admin, insert, fm, appliedIn } = makeApplyAdmin({
      hpbRows: [
        hpbRow({ ref_id: 'CP-LINKED', kind: 'coupon', target: '新規', price: 3980 }),
        hpbRow({ ref_id: 'CP-LINKED-ENDED', kind: 'coupon', missing_since: '2026-10-20T00:00:00.000Z', applied_at: '2026-10-01T00:00:00.000Z' }),
        hpbRow({ ref_id: 'CP-NEW', kind: 'coupon' }),
      ],
      existing: [{ id: 'm1', hpb_ref_id: 'CP-LINKED' }, { id: 'm2', hpb_ref_id: 'CP-LINKED-ENDED' }],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, coupons_in_menus: 2, coupons: 1 });
    expect(insert).not.toHaveBeenCalled();
    expect(fm.update).not.toHaveBeenCalled();
    expect(appliedIn).toHaveBeenCalledWith('ref_id', ['CP-LINKED']);
  });

  test('非表示のクーポンに紐付くメニューは非公開にする(クーポンの警告には数えない)', async () => {
    const { admin, fm, updateEq } = makeApplyAdmin({
      hpbRows: [hpbRow({ ref_id: 'CP-LINKED', kind: 'coupon', is_hidden: true, applied_at: '2026-10-01T00:00:00.000Z' })],
      existing: [{ id: 'm1', hpb_ref_id: 'CP-LINKED' }],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, hidden: 1 });
    expect(fm.update).toHaveBeenCalledWith({ is_published: false });
    expect(updateEq).toHaveBeenCalledWith('id', 'm1');
  });

  test('今の店舗IDとは別の店舗IDで取得した行は作らない', async () => {
    const { admin, insert } = makeApplyAdmin({
      hpbRows: [hpbRow({ ref_id: 'MN-OTHER', store_id: 'H999' }), hpbRow()],
      existing: [],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, inserted: 1, other_store: 1 });
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ hpb_ref_id: 'MN1' })]);
  });

  test('今の店舗IDの前後の空白は無視して比べる', async () => {
    const { admin } = makeApplyAdmin({ hpbRows: [hpbRow()], existing: [], profile: { hpb_sln_id: ' H1 ' } });
    expect((await applyHpbMenusToFacilityMenus(admin, FACILITY)).inserted).toBe(1);
  });

  test.each([
    ['施設が見つからない', null],
    ['店舗IDを未設定に戻した', { hpb_sln_id: null }],
  ])('%s → どの行も作らない', async (_label, profile) => {
    const { admin, insert } = makeApplyAdmin({ hpbRows: [hpbRow()], existing: [], profile });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, other_store: 1 });
    expect(insert).not.toHaveBeenCalled();
  });

  test('is_hidden=true + 既存あり → is_published=false で非公開化', async () => {
    const { admin, fm, updateEq, appliedIn } = makeApplyAdmin({
      hpbRows: [hpbRow({ is_hidden: true })],
      existing: [{ id: 'm1', hpb_ref_id: 'MN1' }],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, hidden: 1 });
    expect(fm.update).toHaveBeenCalledWith({ is_published: false });
    expect(updateEq).toHaveBeenCalledWith('id', 'm1');
    expect(appliedIn).toHaveBeenCalledWith('ref_id', ['MN1']);
  });

  test('is_hidden=true + 非公開化エラー → throw', async () => {
    const { admin } = makeApplyAdmin({
      hpbRows: [hpbRow({ is_hidden: true })],
      existing: [{ id: 'm1', hpb_ref_id: 'MN1' }],
      updateErrors: [{ message: 'db' }],
    });
    await expect(applyHpbMenusToFacilityMenus(admin, FACILITY)).rejects.toThrow('hide update failed');
  });

  test('is_hidden=true + 既存なし → 何もしない', async () => {
    const { admin, fm, insert } = makeApplyAdmin({
      hpbRows: [hpbRow({ is_hidden: true })],
      existing: [],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual(EMPTY_RESULT);
    expect(fm.update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  test('override 後の name が空 → skip', async () => {
    const { admin, insert } = makeApplyAdmin({
      hpbRows: [hpbRow({ name_override: '   ' })],
      existing: [],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ ...EMPTY_RESULT, skipped: 1 });
    expect(insert).not.toHaveBeenCalled();
  });

  test('混在: 作るのはまだ無い今の店舗の通常メニューだけ', async () => {
    const { admin, insert, appliedIn } = makeApplyAdmin({
      hpbRows: [
        hpbRow({ ref_id: 'MN-NEW' }),
        hpbRow({ ref_id: 'MN-EXISTING', applied_at: '2026-10-01T00:00:00.000Z' }),
        hpbRow({ ref_id: 'CP-NEW-ONLY', kind: 'coupon', target: '新規' }),
        hpbRow({ ref_id: 'MN-ENDED', missing_since: '2026-10-20T00:00:00.000Z' }),
        hpbRow({ ref_id: 'MN-OTHER', store_id: 'H999' }),
        hpbRow({ ref_id: 'MN-DELETED', applied_at: '2026-10-01T00:00:00.000Z' }),
      ],
      existing: [{ id: 'm1', hpb_ref_id: 'MN-EXISTING' }],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({
      inserted: 1, existing: 1, hidden: 0, skipped: 0, coupons: 1, coupons_in_menus: 0, ended: 1, other_store: 1, deleted: 1,
    });
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ hpb_ref_id: 'MN-NEW' })]);
    expect(appliedIn).toHaveBeenCalledWith('ref_id', ['MN-NEW']);
  });
});

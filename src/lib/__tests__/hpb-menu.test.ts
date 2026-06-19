/**
 * @jest-environment node
 *
 * Tests for lib/hpb-menu.ts
 * getFacilitySlnId / saveHpbRows / scrapeAndSaveFacility / listHpbMenus を網羅(branches100%)。
 */

jest.mock('../hpb-scraper', () => ({
  fetchStoreRows: jest.fn(),
  httpFetch: jest.fn(),
}));

import {
  getFacilitySlnId,
  saveHpbRows,
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

function asAdmin(from: jest.Mock): SupabaseClient {
  return { from } as unknown as SupabaseClient;
}

function profileChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
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
  test('upserts valid rows, preserves overrides (no override cols in payload)', async () => {
    const chain = upsertChain(null);
    const from = jest.fn().mockReturnValue(chain);
    const res = await saveHpbRows(asAdmin(from), FACILITY, [validRow(), validRow({ refId: 'CP2' })]);
    expect(res).toEqual({ ok: 2, skipped: 0, failed: 0 });
    const payload = chain.upsert.mock.calls[0][0];
    expect(chain.upsert.mock.calls[0][1]).toEqual({ onConflict: 'facility_id,ref_id' });
    expect(Object.keys(payload[0])).not.toContain('name_override');
    expect(Object.keys(payload[0])).not.toContain('is_hidden');
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

describe('scrapeAndSaveFacility', () => {
  test('sln not set → no scrape (default fetchFn branch)', async () => {
    const from = jest.fn().mockReturnValue(profileChain(null));
    const res = await scrapeAndSaveFacility(asAdmin(from), FACILITY);
    expect(res).toEqual({ slnId: null, fetched: 0, ok: 0, skipped: 0, failed: 0 });
    expect(fetchStoreRows).not.toHaveBeenCalled();
  });
  test('sln set → scrapes and saves (explicit fetchFn branch)', async () => {
    const from = jest
      .fn()
      .mockReturnValueOnce(profileChain({ hpb_sln_id: 'H1' }))
      .mockReturnValueOnce(upsertChain(null));
    (fetchStoreRows as jest.Mock).mockResolvedValue([validRow(), validRow({ refId: 'CP2' })]);
    const customFetch = jest.fn();
    const res = await scrapeAndSaveFacility(asAdmin(from), FACILITY, customFetch);
    expect(res).toEqual({ slnId: 'H1', fetched: 2, ok: 2, skipped: 0, failed: 0 });
    expect(fetchStoreRows).toHaveBeenCalledWith('H1', customFetch);
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
function hpbRow(over: Partial<HpbMenuDurationRow> = {}): HpbMenuDurationRow {
  return {
    facility_id: FACILITY,
    ref_id: 'CP1',
    kind: 'coupon',
    store_id: 'H1',
    name: 'メニューA',
    target: '全員',
    duration_min: 70,
    price: 6900,
    description: '説明',
    name_override: null,
    duration_min_override: null,
    price_override: null,
    description_override: null,
    is_hidden: false,
    updated_at: '',
    created_at: '',
    ...over,
  };
}

interface ApplyOpts {
  hpbRows: HpbMenuDurationRow[] | null;
  hpbError?: unknown;
  existing?: { id: string; hpb_ref_id: string | null }[] | null;
  existingError?: unknown;
  updateErrors?: unknown[];
  insertError?: unknown;
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
  const from = jest.fn((table: string) => {
    if (table === 'hpb_menu_durations') return menuListChain(o.hpbRows, o.hpbError ?? null);
    return fm;
  });
  return { admin: asAdmin(from), fm, insert, updateEq };
}

describe('applyHpbMenusToFacilityMenus', () => {
  test('listHpbMenus が null → throw', async () => {
    const { admin } = makeApplyAdmin({ hpbRows: null, hpbError: { message: 'db' } });
    await expect(applyHpbMenusToFacilityMenus(admin, FACILITY)).rejects.toThrow('listHpbMenus failed');
  });

  test('行ゼロ → 何もせず 0 件', async () => {
    const { admin, insert } = makeApplyAdmin({ hpbRows: [] });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ inserted: 0, updated: 0, hidden: 0, skipped: 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  test('facility_menus 読み取りエラー → throw', async () => {
    const { admin } = makeApplyAdmin({ hpbRows: [hpbRow()], existingError: { message: 'db' } });
    await expect(applyHpbMenusToFacilityMenus(admin, FACILITY)).rejects.toThrow('facility_menus read failed');
  });

  test('新規メニュー → is_published=false / category=メニュー で insert', async () => {
    const { admin, insert } = makeApplyAdmin({ hpbRows: [hpbRow()], existing: [] });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ inserted: 1, updated: 0, hidden: 0, skipped: 0 });
    expect(insert).toHaveBeenCalledWith([
      {
        facility_id: FACILITY,
        hpb_ref_id: 'CP1',
        category: HPB_APPLIED_CATEGORY,
        name: 'メニューA',
        price: 6900,
        duration_minutes: 70,
        description: '説明',
        is_published: false,
      },
    ]);
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

  test('insert エラー → throw', async () => {
    const { admin } = makeApplyAdmin({ hpbRows: [hpbRow()], existing: [], insertError: { message: 'db' } });
    await expect(applyHpbMenusToFacilityMenus(admin, FACILITY)).rejects.toThrow('insert failed');
  });

  test('override 優先の値で既存行を更新(value列のみ)', async () => {
    const { admin, fm, updateEq, insert } = makeApplyAdmin({
      hpbRows: [
        hpbRow({
          name_override: 'X',
          duration_min_override: 80,
          price_override: 5000,
          description_override: 'D',
        }),
      ],
      existing: [{ id: 'm1', hpb_ref_id: 'CP1' }],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ inserted: 0, updated: 1, hidden: 0, skipped: 0 });
    expect(fm.update).toHaveBeenCalledWith({
      name: 'X',
      price: 5000,
      duration_minutes: 80,
      description: 'D',
    });
    expect(updateEq).toHaveBeenCalledWith('id', 'm1');
    expect(insert).not.toHaveBeenCalled();
  });

  test('value 更新エラー → throw', async () => {
    const { admin } = makeApplyAdmin({
      hpbRows: [hpbRow()],
      existing: [{ id: 'm1', hpb_ref_id: 'CP1' }],
      updateErrors: [{ message: 'db' }],
    });
    await expect(applyHpbMenusToFacilityMenus(admin, FACILITY)).rejects.toThrow('value update failed');
  });

  test('is_hidden=true + 既存あり → is_published=false で非公開化', async () => {
    const { admin, fm } = makeApplyAdmin({
      hpbRows: [hpbRow({ is_hidden: true })],
      existing: [{ id: 'm1', hpb_ref_id: 'CP1' }],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ inserted: 0, updated: 0, hidden: 1, skipped: 0 });
    expect(fm.update).toHaveBeenCalledWith({ is_published: false });
  });

  test('is_hidden=true + 非公開化エラー → throw', async () => {
    const { admin } = makeApplyAdmin({
      hpbRows: [hpbRow({ is_hidden: true })],
      existing: [{ id: 'm1', hpb_ref_id: 'CP1' }],
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
    expect(res).toEqual({ inserted: 0, updated: 0, hidden: 0, skipped: 0 });
    expect(fm.update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  test('override 後の name が空 → skip', async () => {
    const { admin, insert } = makeApplyAdmin({
      hpbRows: [hpbRow({ name_override: '   ' })],
      existing: [],
    });
    const res = await applyHpbMenusToFacilityMenus(admin, FACILITY);
    expect(res).toEqual({ inserted: 0, updated: 0, hidden: 0, skipped: 1 });
    expect(insert).not.toHaveBeenCalled();
  });
});

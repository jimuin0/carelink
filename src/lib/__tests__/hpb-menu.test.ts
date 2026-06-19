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

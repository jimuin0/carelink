/**
 * @jest-environment node
 *
 * Tests for lib/area-seo.ts
 * Covers: getAreaSeoContent (fallback chain), enrichSeoContent
 */

jest.mock('../supabase-server');

import { getAreaSeoContent, enrichSeoContent } from '../area-seo';
import type { AreaSeoContent } from '../area-seo';

const { createServerSupabaseClient } = require('../supabase-server');

const MOCK_ROW = {
  h2_title: 'Test H2',
  body_text: 'Body {{facility_count}} {{avg_rating}} {{area_name}}',
  faq_items: [{ question: 'Q?', answer: 'A {{area_name}}.' }],
};

function buildSupabaseMock(returnData: object | null) {
  const mockMaybeSingle = jest.fn().mockResolvedValue({ data: returnData });
  const mockIs2 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
  const mockEq3 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
  const mockIs1 = jest.fn().mockReturnValue({ is: mockIs2, maybeSingle: mockMaybeSingle });
  const mockEq2 = jest.fn().mockReturnValue({ eq: mockEq3, is: mockIs2 });
  const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2, is: mockIs1 });
  const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

  createServerSupabaseClient.mockReturnValue({
    from: jest.fn().mockReturnValue({ select: mockSelect }),
  });

  return { mockMaybeSingle };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getAreaSeoContent', () => {
  test('returns null when no data at any fallback level', async () => {
    buildSupabaseMock(null);
    const result = await getAreaSeoContent('tokyo');
    expect(result).toBeNull();
  });

  test('returns content when prefecture-level fallback matches', async () => {
    buildSupabaseMock(MOCK_ROW);
    const result = await getAreaSeoContent('tokyo');
    expect(result).not.toBeNull();
    expect(result!.h2_title).toBe('Test H2');
    expect(result!.body_text).toBe(MOCK_ROW.body_text);
    expect(Array.isArray(result!.faq_items)).toBe(true);
  });

  test('returns content with empty faq_items when faq is null', async () => {
    buildSupabaseMock({ ...MOCK_ROW, faq_items: null });
    const result = await getAreaSeoContent('tokyo');
    expect(result!.faq_items).toEqual([]);
  });

  test('calls supabase with citySlug + businessTypeSlug when both provided', async () => {
    buildSupabaseMock(MOCK_ROW);
    await getAreaSeoContent('osaka', 'toyonaka', 'hair-salon');
    expect(createServerSupabaseClient).toHaveBeenCalled();
  });

  test('handles null h2_title correctly', async () => {
    buildSupabaseMock({ ...MOCK_ROW, h2_title: null });
    const result = await getAreaSeoContent('tokyo');
    expect(result!.h2_title).toBeNull();
  });
});

describe('enrichSeoContent', () => {
  const baseContent: AreaSeoContent = {
    h2_title: 'H2 for {{area_name}}',
    body_text: '{{facility_count}} facilities, avg {{avg_rating}}, in {{area_name}}, type {{business_type}}',
    faq_items: [{ question: '{{area_name}} Q?', answer: '{{avg_rating}} A.' }],
  };

  function buildEnrichMock(facilities: { rating_avg: number | null }[], count: number) {
    const result = { data: facilities, count };
    // The query is awaited directly: `await query`. Need each .eq() to return a thenable.
    const makeThenable = (): Record<string, unknown> => ({
      eq: jest.fn().mockImplementation(() => makeThenable()),
      then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      catch: (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject),
    });

    const mockSelect = jest.fn().mockReturnValue(makeThenable());

    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: mockSelect }),
    });
  }

  test('replaces {{facility_count}} in body_text', async () => {
    buildEnrichMock([{ rating_avg: 4.5 }, { rating_avg: 4.0 }], 42);
    const result = await enrichSeoContent(baseContent, '東京都');
    expect(result.body_text).toContain('42');
  });

  test('replaces {{area_name}} with prefectureName when no city', async () => {
    buildEnrichMock([], 0);
    const result = await enrichSeoContent(baseContent, '東京都');
    expect(result.body_text).toContain('東京都');
    expect(result.h2_title).toContain('東京都');
  });

  test('replaces {{area_name}} with prefecture+city when city provided', async () => {
    buildEnrichMock([], 5);
    const result = await enrichSeoContent(baseContent, '大阪府', '豊中市');
    expect(result.body_text).toContain('大阪府豊中市');
  });

  test('replaces {{avg_rating}} with — when no facilities', async () => {
    buildEnrichMock([], 0);
    const result = await enrichSeoContent(baseContent, '東京都');
    expect(result.body_text).toContain('—');
  });

  test('replaces {{business_type}} with default when not provided', async () => {
    buildEnrichMock([], 0);
    const result = await enrichSeoContent(baseContent, '東京都');
    expect(result.body_text).toContain('サロン・クリニック');
  });

  test('replaces {{business_type}} with provided value', async () => {
    buildEnrichMock([], 3);
    const result = await enrichSeoContent(baseContent, '東京都', null, 'ネイル');
    expect(result.body_text).toContain('ネイル');
  });

  test('replaces in faq_items', async () => {
    buildEnrichMock([], 0);
    const result = await enrichSeoContent(baseContent, '愛知県');
    expect(result.faq_items[0].question).toContain('愛知県');
  });

  test('handles null h2_title gracefully', async () => {
    buildEnrichMock([], 0);
    const content = { ...baseContent, h2_title: null };
    const result = await enrichSeoContent(content, '東京都');
    expect(result.h2_title).toBeNull();
  });
});

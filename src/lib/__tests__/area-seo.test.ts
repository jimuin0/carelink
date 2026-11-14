/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/area-seo.ts
 * Covers: getAreaSeoContent (fallback chain), enrichSeoContent
 */

jest.mock('../supabase-server');

import { getAreaSeoContent, enrichSeoContent, isIndexableAreaQuality } from '../area-seo';
import type { AreaSeoContent } from '../area-seo';

const { createServerSupabaseClient } = require('../supabase-server');

const MOCK_ROW = {
  h2_title: 'Test H2',
  body_text: 'Body {{facility_count}} {{avg_rating}} {{area_name}}',
  faq_items: [{ question: 'Q?', answer: 'A {{area_name}}.' }],
};

function buildSupabaseMock(returnData: object | null) {
  const mockMaybeSingle = jest.fn().mockResolvedValue({ data: returnData });
  // Level 4: .is('business_type_slug', null).maybeSingle()
  const mockIs3 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
  // Level 3: .is('city_slug', null).eq('business_type_slug', ...).maybeSingle()
  //          .is('city_slug', null).is('business_type_slug', null).maybeSingle()
  const mockEq3 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
  const mockIs2 = jest.fn().mockReturnValue({ eq: mockEq3, is: mockIs3, maybeSingle: mockMaybeSingle });
  // Level 2: .eq('city_slug', ...).is('business_type_slug', null).maybeSingle()
  const mockIs1 = jest.fn().mockReturnValue({ eq: mockEq3, is: mockIs2, maybeSingle: mockMaybeSingle });
  // Level 1: .eq('city_slug', ...).eq('business_type_slug', ...).maybeSingle()
  const mockEq2 = jest.fn().mockReturnValue({ eq: mockEq3, is: mockIs1, maybeSingle: mockMaybeSingle });
  const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2, is: mockIs2, maybeSingle: mockMaybeSingle });
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
  // 低 A213: 各段の読み取り失敗を「テキスト無し」として次段へ落とさず throw する。
  test.each([
    ['level 1', ['osaka', 'kita', 'nail']],
    ['level 2', ['osaka', 'kita']],
    ['level 3', ['osaka', null, 'nail']],
    ['level 4', ['osaka']],
  ] as const)('%s の読み取り失敗 → throw', async (_label, args) => {
    const { mockMaybeSingle } = buildSupabaseMock(null);
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } });
    await expect(getAreaSeoContent(...(args as [string, string?, string?]))).rejects.toThrow('getAreaSeoContent failed');
  });

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

  test('returns content for city + businessType (level 1 hit)', async () => {
    buildSupabaseMock(MOCK_ROW);
    const result = await getAreaSeoContent('osaka', 'kita', 'nail');
    expect(result).not.toBeNull();
  });

  test('returns content for city only (level 2 hit)', async () => {
    buildSupabaseMock(MOCK_ROW);
    const result = await getAreaSeoContent('osaka', 'kita');
    expect(result).not.toBeNull();
  });

  test('returns content for businessType only (level 3 hit)', async () => {
    buildSupabaseMock(MOCK_ROW);
    const result = await getAreaSeoContent('osaka', null, 'nail');
    expect(result).not.toBeNull();
  });

  test('returns null when both city and businessType but no match at any level', async () => {
    buildSupabaseMock(null);
    const result = await getAreaSeoContent('osaka', 'kita', 'nail');
    expect(result).toBeNull();
  });
});

describe('isIndexableAreaQuality', () => {
  const content = {
    h2: '豊中市のヘアサロンをお探しの方へ',
    intro: '豊中市のヘアサロンを、メニュー・料金・写真・口コミ・営業時間・アクセスなどの判断材料から比較できる地域別の案内です。予約前に各施設の掲載内容、対応メニュー、予約条件をご確認ください。掲載情報は施設ごとに異なるため、希望する内容を確認してから予約へ進めます。',
    highlights: ['料金とメニューを比較', '写真と口コミを確認'],
    faqs: [
      { question: '選ぶポイントは？', answer: '営業時間、メニュー、料金、アクセス、掲載写真などを比較し、希望に合う施設か確認してください。' },
      { question: '予約方法は？', answer: '施設ページの予約枠、注意事項、キャンセル条件をご確認のうえ、表示された予約手順に進んでください。希望日時や施術内容を先に整理しておくと比較しやすくなります。' },
    ],
  };

  test('requires a positive inventory count and content', () => {
    expect(isIndexableAreaQuality(null, content)).toBe(false);
    expect(isIndexableAreaQuality(undefined, content)).toBe(false);
    expect(isIndexableAreaQuality(0, content)).toBe(false);
    expect(isIndexableAreaQuality(1, null)).toBe(false);
    expect(isIndexableAreaQuality(1, content)).toBe(true);
  });

  test.each([
    ['short heading', { ...content, h2: '短い' }],
    ['short intro', { ...content, intro: '短い説明' }],
    ['one highlight', { ...content, highlights: ['1つ'] }],
    ['one faq', { ...content, faqs: [content.faqs[0]] }],
  ])('rejects %s', (_label, candidate) => {
    expect(isIndexableAreaQuality(1, candidate)).toBe(false);
  });

  test('個々の下限は満たしても本文全体が 300 字未満なら索引させない（合計の下限だけで落ちる）', () => {
    const minimal = {
      h2: 'あ'.repeat(10),
      intro: 'い'.repeat(120),
      highlights: ['う', 'え'],
      faqs: [{ question: 'Q1', answer: 'A1' }, { question: 'Q2', answer: 'A2' }],
    };
    // 合計 10 + 120 + 2 + 8 = 140 字
    expect(isIndexableAreaQuality(1, minimal)).toBe(false);
    // 同じ形で合計だけを 300 字に届かせると通る（＝落ちた原因は合計の下限だけ）
    const enough = { ...minimal, faqs: [minimal.faqs[0], { question: 'Q2', answer: 'お'.repeat(170) }] };
    expect(isIndexableAreaQuality(1, enough)).toBe(true);
  });
});

describe('enrichSeoContent', () => {
  const baseContent: AreaSeoContent = {
    h2_title: 'H2 for {{area_name}}',
    body_text: '{{facility_count}} facilities, avg {{avg_rating}}, in {{area_name}}, type {{business_type}}',
    faq_items: [{ question: '{{area_name}} Q?', answer: '{{avg_rating}} A.' }],
  };

  function buildEnrichMock(facilities: { rating_avg: number | null }[], count: number, error: unknown = null) {
    const result = { data: facilities, count, error };
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

  test('handles null count and null facilities', async () => {
    buildEnrichMock(null as unknown as { rating_avg: number | null }[], null as unknown as number);
    const result = await enrichSeoContent(baseContent, '東京都');
    expect(result.body_text).toContain('0');
    expect(result.body_text).toContain('—');
  });

  test('評価の無い施設（rating_avg null）は平均に入れない', async () => {
    buildEnrichMock([{ rating_avg: null }, { rating_avg: 5 }], 2);
    const result = await enrichSeoContent(baseContent, '東京都');
    // 以前は (0 + 5) / 2 = 2.5 と低く出ていた（点検 A51）
    expect(result.body_text).toContain('5.0');
    expect(result.body_text).not.toContain('2.5');
  });

  test('全施設が未評価なら平均は —', async () => {
    buildEnrichMock([{ rating_avg: null }], 1);
    const result = await enrichSeoContent(baseContent, '東京都');
    expect(result.body_text).toContain('—');
  });

  test('読み取り失敗は「0件」と書かずに例外にする', async () => {
    buildEnrichMock(null as unknown as { rating_avg: number | null }[], null as unknown as number, { message: 'db down' });
    await expect(enrichSeoContent(baseContent, '東京都')).rejects.toThrow('enrichSeoContent failed');
  });
});

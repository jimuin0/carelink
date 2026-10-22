/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Page, { generateMetadata } from '../page';
import { notFound } from 'next/navigation';
import { safeCaptureException } from '@/lib/safe';

const mockFrom = jest.fn();
const mockEq = jest.fn();
const mockIn = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mockFrom }) }));
jest.mock('next/navigation', () => ({ notFound: jest.fn(() => { throw new Error('TEST_NOT_FOUND'); }) }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/data/symptom-seo', () => ({ getSymptomSeo: () => null }));
jest.mock('@/components/search/FacilityCard', () => ({ __esModule: true, default: ({ facility }: { facility: { name: string } }) => <p>{facility.name}</p> }));

const symptom = { id: 'symptom-id', name: 'テスト症状', slug: 'synthetic', category: 'テスト分類' };
const baseline = [symptom, [{ facility_id: 'facility-id', description: '' }], [{ id: 'facility-id', name: 'テスト施設' }], [{ name: '関連テスト症状', slug: 'related' }]];
const props = () => ({ params: Promise.resolve({ slug: 'synthetic' }) });

function results(rows: unknown[] = baseline, failIndex = -1, kind = '') {
  let index = 0;
  mockFrom.mockImplementation(() => {
    const i = index++;
    const failure = { code: '08006', message: 'private database details', details: 'private SQL content' };
    const response = i === failIndex
      ? kind === 'reject' ? Promise.reject(failure) : Promise.resolve({ data: kind === 'data-error' ? rows[i] : null, error: failure })
      : Promise.resolve({ data: rows[i], error: null });
    const chain = {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockImplementation(function(this: unknown, ...args: unknown[]) { mockEq(...args); return this; }),
      in: jest.fn().mockImplementation(function(this: unknown, ...args: unknown[]) { mockIn(...args); return this; }),
      neq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
      maybeSingle: () => response, then: response.then.bind(response),
    };
    return chain;
  });
}

beforeEach(() => { jest.clearAllMocks(); results(); });

test.each(['empty-error', 'data-error', 'reject'])('metadata %s is unavailable rather than missing', async (kind) => {
  results(baseline, 0, kind);
  await expect(generateMetadata(props())).rejects.toThrow('PAGE_DATA_UNAVAILABLE');
  expect(notFound).not.toHaveBeenCalled();
  expect(mockFrom).toHaveBeenCalledTimes(1);
  expect(safeCaptureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'DATABASE_FAILURE:08006' }), 'symptom-page');
});

/**
 * 施設 0 件の症状ページは検索結果に出さない（2026年10月22日・神原さん決定「施設が載るまで検索に出さない」）。
 * 対応症状を登録する手段が無く、本番は 30 症状とも 0 件の空ページのまま index されていた。
 */
describe('metadata は公開施設の有無で index を切り替える', () => {
  test.each([
    ['対応表に行が無い', [symptom, []]],
    ['対応表はあるが公開中の施設が無い（下書き・非公開のみ）', [symptom, [{ facility_id: 'draft-id', description: '' }], []]],
  ])('%s → noindex, follow', async (_label, rows) => {
    results(rows as unknown[]);
    await expect(generateMetadata(props())).resolves.toMatchObject({ robots: { index: false, follow: true } });
  });

  test('公開中の施設が1件でもあれば robots を出さない（index に戻る）', async () => {
    const metadata = await generateMetadata(props());
    expect(metadata).not.toHaveProperty('robots');
    expect(mockEq).toHaveBeenCalledWith('status', 'published');
  });

  test('施設の読み取りに失敗したら noindex にも index にも倒さず、取得失敗にする', async () => {
    results(baseline, 2);
    await expect(generateMetadata(props())).rejects.toThrow('PAGE_DATA_UNAVAILABLE');
  });
});

test('施設 0 件の本文は行き止まりにせず、業種の一覧へ案内する', async () => {
  results([symptom, [], []]);
  const html = renderToStaticMarkup(await Page(props()));
  expect(html).toContain('href="/type/acupuncture"');
  expect(html).toContain('鍼灸院・整骨院・整体の一覧を見る');
  expect(html).toContain('鍼灸院・整骨院・整体の一覧から探すこともできます。');
  expect(html).toContain('href="/search"');
  // 症状を特定の業種の扱うものとは言わない（アレルギー・不妊などは整骨院の対象外）。
  expect(html).not.toContain('のご相談は');
});

/**
 * 症状ページは疾患名（椎間板ヘルニア・顔面神経麻痺・不妊など）に原因・治療の選択肢と施設を並べる。
 * 症状チェッカーと同じく、診断ではないこと・受診勧奨を必ず出す（施設の有無にかかわらず）。
 */
test.each([
  ['施設 0 件', [symptom, [], []]],
  ['施設あり', baseline],
])('%s でも医療上の免責（診断ではない・受診勧奨）を出す', async (_label, rows) => {
  results(rows as unknown[]);
  const html = renderToStaticMarkup(await Page(props()));
  expect(html).toContain('role="note"');
  expect(html).toContain('医学的な診断ではありません。');
  expect(html).toContain('自己判断せず医療機関を受診してください。');
});

test('施設があるときは業種一覧への案内を出さない', async () => {
  const html = renderToStaticMarkup(await Page(props()));
  expect(html).not.toContain('href="/type/acupuncture"');
});

describe.each([['symptom', 0], ['facility-links', 1], ['facilities', 2], ['related', 3]] as const)('%s read', (_stage, index) => {
  test.each(['empty-error', 'data-error', 'reject'])('%s never renders 404 or empty/partial results', async (kind) => {
    results(baseline, index, kind);
    await expect(Page(props())).rejects.toThrow('PAGE_DATA_UNAVAILABLE');
    expect(notFound).not.toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledTimes(index + 1);
    expect(safeCaptureException).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((safeCaptureException as jest.Mock).mock.calls)).not.toContain('private');
  });
});

test('a genuinely absent symptom still returns 404', async () => {
  results([null]);
  await expect(Page(props())).rejects.toThrow('TEST_NOT_FOUND');
  expect(notFound).toHaveBeenCalledTimes(1);
  expect(mockFrom).toHaveBeenCalledTimes(1);
  expect(safeCaptureException).not.toHaveBeenCalled();
});

test('genuinely absent metadata retains the missing title', async () => {
  results([null]);
  await expect(generateMetadata(props())).resolves.toEqual({ title: '症状が見つかりません' });
});

test('published facilities and related symptoms still render', async () => {
  const html = renderToStaticMarkup(await Page(props()));
  expect(html).toContain('テスト施設');
  expect(html).toContain('関連テスト症状');
  expect(html).not.toContain('対応可能な施設は登録されていません');
  expect(mockEq).toHaveBeenCalledWith('status', 'published');
  expect(mockIn).toHaveBeenCalledWith('id', ['facility-id']);
});

test('genuine empty links show no facilities and do not run a facility query', async () => {
  results([symptom, [], []]);
  expect(renderToStaticMarkup(await Page(props()))).toContain('対応可能な施設は登録されていません');
  expect(mockFrom.mock.calls.map(([table]) => table)).toEqual(['symptoms', 'facility_symptoms', 'symptoms']);
  expect(safeCaptureException).not.toHaveBeenCalled();
});

test('normal metadata retains the canonical symptom URL', async () => {
  await expect(generateMetadata(props())).resolves.toMatchObject({ alternates: { canonical: '/symptom/synthetic' } });
});

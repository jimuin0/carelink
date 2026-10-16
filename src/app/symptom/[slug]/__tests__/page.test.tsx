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
  expect(safeCaptureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'DATABASE_FAILURE:08006' }), 'symptom-metadata');
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

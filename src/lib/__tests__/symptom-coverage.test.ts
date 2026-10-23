/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
/**
 * 公開施設が結びついた症状の判定（2026年10月22日・神原さん決定「施設が載るまで検索に出さない」）。
 * sitemap・症状チェッカーの noindex 判定がこの結果を使う。
 */
const mockFrom = jest.fn();
jest.mock('../supabase-server', () => ({ createServerSupabaseClient: () => ({ from: mockFrom }) }));

import { getSymptomSlugsWithPublishedFacilities } from '../symptom-coverage';
import { SYMPTOM_FALLBACK_HREF, SYMPTOM_FALLBACK_TYPE_NAME, SYMPTOM_FALLBACK_TYPE_SLUG } from '../symptom-fallback';
import { businessTypeSlugs } from '../seo-constants';
import { readFileSync } from 'fs';
import { join } from 'path';

function chain(result: { data: unknown; error: unknown }) {
  const c = {
    select: jest.fn(() => c),
    eq: jest.fn(() => Promise.resolve(result)),
  };
  return c;
}

beforeEach(() => mockFrom.mockReset());

describe('getSymptomSlugsWithPublishedFacilities', () => {
  test('症状マスタから、公開施設と内部結合で結びついた症状の slug だけを返す', async () => {
    const c = chain({ data: [{ slug: 'low-back-pain' }, { slug: 'headache' }], error: null });
    mockFrom.mockReturnValue(c);
    await expect(getSymptomSlugsWithPublishedFacilities()).resolves.toEqual(new Set(['low-back-pain', 'headache']));
    // 対応表側から引くと施設×症状の行数ぶん返り、API の行数上限で症状が欠ける。マスタ側から引く。
    expect(mockFrom).toHaveBeenCalledWith('symptoms');
    expect(c.select).toHaveBeenCalledWith('slug, facility_symptoms!inner(facility_profiles!inner())');
    expect(c.eq).toHaveBeenCalledWith('facility_symptoms.facility_profiles.status', 'published');
  });

  test('結びついた症状が無ければ空（本番の現状＝対応表 0 行）', async () => {
    mockFrom.mockReturnValue(chain({ data: [], error: null }));
    await expect(getSymptomSlugsWithPublishedFacilities()).resolves.toEqual(new Set());
  });

  test.each([
    ['error が返る', { data: null, error: { code: 'PGRST003' } }],
    ['data が配列でない', { data: null, error: null }],
  ])('%s → 「0件」と取り違えず例外にする', async (_label, result) => {
    mockFrom.mockReturnValue(chain(result));
    await expect(getSymptomSlugsWithPublishedFacilities()).rejects.toThrow('Symptom coverage unavailable');
  });

  test('埋め込みに使う表と列は実在する', () => {
    const snapshot = JSON.parse(readFileSync(join(process.cwd(), 'src/lib/schema-snapshot.json'), 'utf8')) as Record<string, string[]>;
    expect(snapshot.symptoms).toContain('slug');
    expect(snapshot.facility_symptoms).toEqual(expect.arrayContaining(['facility_id', 'symptom_id']));
    expect(snapshot.facility_profiles).toContain('status');
  });
});

describe('空の症状ページから案内する業種', () => {
  test('実在する業種ページを指す', () => {
    expect(businessTypeSlugs[SYMPTOM_FALLBACK_TYPE_SLUG]).toBe('鍼灸院・整骨院');
    // 表示名は整体を含む（保存値・スラッグは従来どおり。src/lib/business-type-label.ts）。
    expect(SYMPTOM_FALLBACK_TYPE_NAME).toBe('鍼灸院・整骨院・整体');
    expect(SYMPTOM_FALLBACK_HREF).toBe('/type/acupuncture');
  });
});

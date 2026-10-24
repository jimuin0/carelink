/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 管理画面の入力欄の候補・入力例・医療広告の注意を業種から引く（2026年10月23日）。
 * 以前はメニューのカテゴリ・スタッフの入力例が美容室向けに固定で、医療広告の注意は全業種に出ていた。
 */
import { businessTypes } from '../constants';
import { medicalBusinessTypes } from '../medical-business-types';
import {
  BUSINESS_TYPE_COPY, FALLBACK_BUSINESS_TYPE_COPY, businessTypeCopy, businessTypesWithoutCopy,
  loadFacilityBusinessType, menuCategorySuggestions,
} from '../business-type-copy';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('businessTypeCopy', () => {
  test('保存値の単一ソース（businessTypes）の全業種に文言がある', () => {
    expect(businessTypesWithoutCopy()).toEqual([]);
    expect(Object.keys(BUSINESS_TYPE_COPY).sort()).toEqual([...businessTypes].sort());
  });

  test('業種を足したのに文言を書き忘れたら検出する（負の対照）', () => {
    businessTypes.push('合成業種');
    try {
      expect(businessTypesWithoutCopy()).toEqual(['合成業種']);
    } finally {
      businessTypes.pop();
    }
  });

  test('医療広告の注意は医療機関・鍼灸整骨と、業種の分からない店舗だけ', () => {
    const noticed = businessTypes.filter((type) => businessTypeCopy(type).medicalAdNotice);
    expect(noticed.sort()).toEqual(['その他', '美容クリニック', '鍼灸院・整骨院', ...medicalBusinessTypes].sort());
    expect(businessTypeCopy(null).medicalAdNotice).toBe(true);
    expect(businessTypeCopy(undefined).medicalAdNotice).toBe(true);
    expect(businessTypeCopy('').medicalAdNotice).toBe(true);
  });

  test('一覧に無い業種・空は汎用の文言（美容室の言葉を出さない）', () => {
    for (const value of [null, undefined, '', '未知の業種', 'toString']) {
      expect(businessTypeCopy(value)).toBe(FALLBACK_BUSINESS_TYPE_COPY);
    }
    expect(FALLBACK_BUSINESS_TYPE_COPY.positionExample).not.toContain('スタイリスト');
    expect(FALLBACK_BUSINESS_TYPE_COPY.menuCategories).not.toContain('カット');
  });

  test('美容室以外の業種に美容室の入力例を出さない', () => {
    for (const type of businessTypes.filter((t) => t !== 'ヘアサロン')) {
      const copy = businessTypeCopy(type);
      expect(copy.positionExample).not.toContain('スタイリスト');
      expect(copy.specialtiesExample).not.toContain('カット');
      expect(copy.menuCategories).not.toContain('カット');
    }
    expect(businessTypeCopy('鍼灸院・整骨院').menuCategories[0]).toBe('鍼灸');
    expect(businessTypeCopy('ヘアサロン').menuCategories[0]).toBe('カット');
  });

  test('得意分野の入力例は読点区切り（parseSpecialties が分けられる形）', () => {
    for (const type of businessTypes) expect(businessTypeCopy(type).specialtiesExample).not.toContain(',');
  });
});

describe('menuCategorySuggestions', () => {
  test('業種の候補が先、既に使っているカテゴリを後ろに足す（重複・空白・空は落とす）', () => {
    expect(menuCategorySuggestions('ピラティス', ['体験', ' 独自コース ', '', '独自コース', 'カット']))
      .toEqual(['マシンピラティス', 'マットピラティス', 'パーソナル', 'グループ', '体験', 'その他', '独自コース', 'カット']);
  });

  test('既存カテゴリの指定が無ければ業種の候補だけ', () => {
    expect(menuCategorySuggestions(null)).toEqual(['基本メニュー', 'オプション', 'その他']);
  });
});

describe('loadFacilityBusinessType', () => {
  const client = (result: unknown, onSelect?: (columns: string, id: string) => void) => {
    let columns = '';
    const chain = {
      select: (c: string) => { columns = c; return chain; },
      eq: (_key: string, id: string) => { onSelect?.(columns, id); return chain; },
      maybeSingle: async () => {
        if (result instanceof Error) throw result;
        return result;
      },
    };
    return { from: (table: string) => { expect(table).toBe('facility_profiles'); return chain; } } as unknown as SupabaseClient;
  };

  test('選択中の店舗の業種だけを読む', async () => {
    const seen: [string, string][] = [];
    await expect(loadFacilityBusinessType(client({ data: { business_type: '鍼灸院・整骨院' }, error: null }, (c, id) => seen.push([c, id])), 'f-1'))
      .resolves.toBe('鍼灸院・整骨院');
    expect(seen).toEqual([['business_type', 'f-1']]);
  });

  test.each([
    ['エラー', { data: null, error: { message: 'x' } }],
    ['行なし', { data: null, error: null }],
    ['値が文字列でない', { data: { business_type: null }, error: null }],
    ['例外', new Error('network')],
  ])('読めなければ null（画面は止めない）：%s', async (_label, result) => {
    await expect(loadFacilityBusinessType(client(result), 'f-1')).resolves.toBeNull();
  });
});

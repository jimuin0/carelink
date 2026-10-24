/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { readFileSync } from 'node:fs';
import { medicalBusinessTypeSlugs, medicalBusinessTypes } from '../medical-business-types';
import { businessTypes } from '../constants';
import { businessTypeLabel } from '../business-type-label';
import { businessTypeCopy } from '../business-type-copy';
import { getBusinessTypeName, getBusinessTypeSlug } from '../seo-constants';
import { generateCityTypeContent, generatePrefTypeContent, getBusinessTypeContext } from '../seo-snippets';
import { salonStep1Schema } from '../validations';

test('耳鼻咽喉科は美容クリニックやその他と区別した登録値・検索URLを持つ', () => {
  expect(businessTypes).toContain('耳鼻咽喉科');
  expect(getBusinessTypeSlug('耳鼻咽喉科')).toBe('otorhinolaryngology');
  expect(getBusinessTypeName('otorhinolaryngology')).toBe('耳鼻咽喉科');
  expect(businessTypes).toEqual(expect.arrayContaining(['病院', '総合病院', '内科', '小児科', '歯科']));
});

test.each(Object.entries(medicalBusinessTypeSlugs))('%s: 登録検証・表示・検索リンク・医療向け入力例が一致する', (slug, category) => {
  expect(salonStep1Schema.parse({ facility_name: 'Synthetic clinic', business_type: category,
    representative_name: 'Synthetic', contact_name: 'Synthetic', email: 'synthetic@example.invalid', phone: '09012345678' }).business_type).toBe(category);
  expect(businessTypeLabel(category)).toBe(category);
  expect(getBusinessTypeSlug(category)).toBe(slug);
  expect(getBusinessTypeName(slug)).toBe(category);
  expect(businessTypeCopy(category).medicalAdNotice).toBe(true);
  expect(businessTypeCopy(category).menuCategories).toContain('一般診療');
  expect(getBusinessTypeContext(slug)).not.toBeNull();
  for (const content of [generatePrefTypeContent('fukuoka', slug), generateCityTypeContent('fukuoka', '福岡市早良区', slug)]) {
    expect(content).not.toBeNull();
    expect(content!.h2).toContain(category);
    expect(content!.intro).toContain('ネット予約は対応施設のみ');
    expect(content!.intro).not.toContain('24時間ネット予約が可能');
    expect(content!.faqs.some(f => f.answer.includes('予約の要否は医療機関ごとに異なります'))).toBe(true);
  }
});

test('SQLの許可値は画面・APIと同一で、変更は最新RPCの分類リストに限定する', () => {
  const previous = readFileSync('supabase/migrations/20261022120100_registration_location_normalization.sql', 'utf8');
  const current = readFileSync('supabase/migrations/20261024090000_medical_business_types.sql', 'utf8');
  const list = /new_business_type NOT IN\s*\(([^)]+)\)/;
  const stored = [...current.match(list)![1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  expect(stored.sort()).toEqual([...businessTypes].sort());
  expect(new Set(stored).size).toBe(stored.length);
  const marker = 'CREATE OR REPLACE FUNCTION public.setup_facility_from_registration';
  expect(current.slice(current.indexOf(marker)).replace(list, 'CATEGORY_LIST'))
    .toBe(previous.slice(previous.indexOf(marker)).replace(list, 'CATEGORY_LIST'));
  const fixture = readFileSync('supabase/shadow/facility-setup-fixtures.sql', 'utf8');
  for (const category of medicalBusinessTypes) expect(fixture).toContain(`'${category}'`);
});

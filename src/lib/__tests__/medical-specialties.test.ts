import { medicalSpecialties, medicalSpecialtiesSchema } from '../medical-specialties';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('複数の診療科を一度ずつ選択できる', () => {
  expect(medicalSpecialtiesSchema.parse(['内科', '耳鼻咽喉科'])).toEqual(['内科', '耳鼻咽喉科']);
  expect(medicalSpecialtiesSchema.parse([])).toEqual([]);
});

test('施設区分・不明な値・重複は診療科として受け付けない', () => {
  for (const values of [['病院'], ['診療所・クリニック（複数診療科）'], ['架空科'], ['内科', '内科']]) {
    expect(medicalSpecialtiesSchema.safeParse(values).success).toBe(false);
  }
  expect(medicalSpecialtiesSchema.safeParse([...medicalSpecialties, '内科']).success).toBe(false);
});

test('申込画面とDB制約で受け付ける診療科の一覧は一致する', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261029123954_medical_specialties.sql'), 'utf8');
  const allowed = sql.match(/p_values <@ ARRAY\[([\s\S]*?)\]::text\[\]/)?.[1];
  expect(allowed).toBeDefined();
  const databaseSpecialties = Array.from(allowed!.matchAll(/'([^']+)'/g), match => match[1]);
  expect(databaseSpecialties).toEqual(medicalSpecialties);
});

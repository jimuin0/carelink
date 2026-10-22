/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 施設所在地の正規化（src/lib/facility-location.ts）と、その SQL 版
 * public.normalize_facility_location（申込からの施設作成が使う）が同じ結果を返すことを固定する。
 *
 * 期待値の表は supabase/shadow/facility-setup-fixtures.sql に 1 つだけ置き、CI の使い捨て DB では
 * SQL 版を、ここでは TypeScript 版をその表で検査する（表を二重に持つと片方だけ直す事故が起きる）。
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { citySlugs } from '@/data/city-slugs';
import { DESIGNATED_CITIES, OSAKA_CITY, OSAKA_CITY_WARDS, normalizeFacilityLocation } from '../facility-location';

const ROOT = join(__dirname, '..', '..', '..');
const FIXTURE = join(ROOT, 'supabase/shadow/facility-setup-fixtures.sql');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

type Case = [string | null, string | null, string | null, string, string];

/** SQL の VALUES 行を値の配列へ。NULL と '' 区切りの文字列リテラルだけを扱う。 */
function parseRow(line: string): (string | null)[] {
  return [...line.matchAll(/NULL|'((?:[^']|'')*)'/g)].map((m) => (m[0] === 'NULL' ? null : m[1].replace(/''/g, "'")));
}

function sharedCases(): Case[] {
  const sql = readFileSync(FIXTURE, 'utf8');
  const start = sql.indexOf('-- >>> facility-location cases');
  const end = sql.indexOf('-- <<< facility-location cases');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end).split('\n').slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('('))
    .map((line) => parseRow(line) as Case);
}

/** 指定した関数を定義している最新の migration の本文（後の migration が前の定義を上書きする）。 */
function latestDefinition(fn: string): { name: string; sql: string } {
  const names = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const hits = names.filter((f) => new RegExp(`FUNCTION public\\.${fn}\\(`).test(readFileSync(join(MIGRATIONS, f), 'utf8')));
  expect(hits.length).toBeGreaterThan(0);
  const name = hits[hits.length - 1];
  return { name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') };
}

/** `name constant text[]:=ARRAY[...]` の要素。 */
function sqlArray(sql: string, name: string): string[] {
  const m = sql.match(new RegExp(`${name} constant text\\[\\]:=ARRAY\\[([^\\]]*)\\]`));
  expect(m).not.toBeNull();
  return parseRow(m![1]) as string[];
}

describe('normalizeFacilityLocation（SQL 版と共有する期待値の表）', () => {
  const cases = sharedCases();

  it('表を実際に読めている（空振りしない）', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    for (const row of cases) expect(row).toHaveLength(5);
  });

  it.each(cases)('%p / %p / %p → %p / %p', (prefecture, city, address, expectedCity, expectedAddress) => {
    expect(normalizeFacilityLocation({ prefecture, city, address })).toEqual({ city: expectedCity, address: expectedAddress });
  });
});

describe('都道府県・市区町村の二重表示（申込住所の取り込み）', () => {
  it('都道府県と市区町村を含む住所から番地だけを残す', () => {
    expect(normalizeFacilityLocation({ prefecture: '東京都', city: '渋谷区', address: '東京都渋谷区道玄坂1-2-3' }))
      .toEqual({ city: '渋谷区', address: '道玄坂1-2-3' });
  });

  it('一致しないときは何も取り除かない', () => {
    expect(normalizeFacilityLocation({ prefecture: '東京都', city: '渋谷区', address: '道玄坂1-2-3' }))
      .toEqual({ city: '渋谷区', address: '道玄坂1-2-3' });
  });

  it('都道府県を省略しても市区町村の重複は取り除く', () => {
    expect(normalizeFacilityLocation({ city: '渋谷区', address: '渋谷区道玄坂1' })).toEqual({ city: '渋谷区', address: '道玄坂1' });
  });
});

describe('政令指定都市の市区町村をエリアマスタの単位へ揃える', () => {
  it('大阪市は区を残す（大阪市北区 → 北区）', () => {
    expect(normalizeFacilityLocation({ prefecture: '大阪府', city: '大阪市北区', address: '梅田1-1-1' }))
      .toEqual({ city: '北区', address: '梅田1-1-1' });
  });

  it('「大阪市」だけなら番地の先頭の区を市区町村へ移す', () => {
    expect(normalizeFacilityLocation({ prefecture: '大阪府', city: '大阪市', address: '大阪府大阪市中央区心斎橋筋1' }))
      .toEqual({ city: '中央区', address: '心斎橋筋1' });
  });

  it('他の政令指定都市は市で切り、区は番地へ移して所在地を欠かさない（横浜市中区 → 横浜市）', () => {
    expect(normalizeFacilityLocation({ prefecture: '神奈川県', city: '横浜市中区', address: '山下町1' }))
      .toEqual({ city: '横浜市', address: '中区山下町1' });
  });

  it('堺市堺区 → 堺市（大阪府でも大阪市以外は市の単位）', () => {
    expect(normalizeFacilityLocation({ prefecture: '大阪府', city: '堺市堺区', address: '南瓦町3-1' }))
      .toEqual({ city: '堺市', address: '堺区南瓦町3-1' });
  });

  it('結果は再び正規化しても変わらない（設定画面で保存し直しても揺れない）', () => {
    for (const [prefecture, city, address] of sharedCases()) {
      const once = normalizeFacilityLocation({ prefecture, city, address });
      expect(normalizeFacilityLocation({ prefecture, ...once })).toEqual(once);
    }
  });

  it('正規化後の市区町村はエリアマスタに実在する', () => {
    const masterNames = new Set(Object.values(citySlugs).flatMap((cities) => Object.values(cities)));
    for (const city of DESIGNATED_CITIES.filter((name) => name !== OSAKA_CITY)) expect(masterNames).toContain(city);
    for (const ward of OSAKA_CITY_WARDS) expect(Object.values(citySlugs.osaka)).toContain(ward);
    expect(masterNames).not.toContain(OSAKA_CITY);
    expect(OSAKA_CITY_WARDS).toHaveLength(24);
    expect(DESIGNATED_CITIES).toHaveLength(20);
  });
});

describe('SQL 版（public.normalize_facility_location）との一致と配線', () => {
  const normalizer = latestDefinition('normalize_facility_location');

  it('政令指定都市と大阪市の区の表が TypeScript 版と同じ', () => {
    expect(sqlArray(normalizer.sql, 'designated_cities').sort()).toEqual([...DESIGNATED_CITIES].sort());
    expect(sqlArray(normalizer.sql, 'osaka_wards').sort()).toEqual([...OSAKA_CITY_WARDS].sort());
  });

  it.each(['setup_facility_from_registration', 'link_duplicate_registration'])(
    '最新の %s が正規化を通している',
    (fn) => {
      const { sql } = latestDefinition(fn);
      const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
      expect(body).toMatch(/SELECT \* INTO normalized_location FROM public\.normalize_facility_location\(/);
    },
  );

  it('施設作成は正規化した city / address を facility_profiles へ書く', () => {
    const { sql } = latestDefinition('setup_facility_from_registration');
    expect(sql).toContain('new_prefecture,normalized_location.city,normalized_location.address,');
    expect(sql).not.toMatch(/coalesce\(nullif\(p_profile->>'address',''\),receipt\.address,''\),\s*receipt\.postal_code/);
  });
});

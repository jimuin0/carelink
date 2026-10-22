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
import {
  DESIGNATED_CITIES, OSAKA_CITY, OSAKA_CITY_WARDS, formatFacilityAddress, formatFacilityLocality, normalizeFacilityLocation,
} from '../facility-location';

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

/** `CREATE [OR REPLACE] FUNCTION public.<fn>(` だけを定義とみなす（REVOKE / GRANT だけの migration は数えない）。 */
function definitionPattern(fn: string): RegExp {
  return new RegExp(`CREATE(?:\\s+OR\\s+REPLACE)?\\s+FUNCTION\\s+public\\.${fn}\\(`);
}

/** sql の中の fn の本文（定義の先頭から次の `$$;` まで）。同じファイルの後続関数を含めない。 */
function functionBody(sql: string, fn: string): string {
  const start = sql.search(definitionPattern(fn));
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/** 指定した関数を定義している最新の migration と、その関数の本文（後の migration が前の定義を上書きする）。 */
function latestDefinition(fn: string): { name: string; sql: string; body: string } {
  const pattern = definitionPattern(fn);
  const names = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const hits = names.filter((f) => pattern.test(readFileSync(join(MIGRATIONS, f), 'utf8')));
  expect(hits.length).toBeGreaterThan(0);
  const name = hits[hits.length - 1];
  const sql = readFileSync(join(MIGRATIONS, name), 'utf8');
  return { name, sql, body: functionBody(sql, fn) };
}

const NORMALIZER_CALL = /SELECT \* INTO normalized_location FROM public\.normalize_facility_location\(/;

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

  it('番地が空なら区を番地へ移さない（区だけの番地「中区」を作らない）', () => {
    expect(normalizeFacilityLocation({ prefecture: '神奈川県', city: '横浜市中区', address: '' }))
      .toEqual({ city: '横浜市中区', address: '' });
    expect(normalizeFacilityLocation({ prefecture: '神奈川県', city: '横浜市中区', address: '神奈川県横浜市中区' }))
      .toEqual({ city: '横浜市中区', address: '' });
    // 番地が入った時点でマスタの単位へ揃う。
    expect(normalizeFacilityLocation({ prefecture: '神奈川県', city: '横浜市中区', address: '山下町1' }))
      .toEqual({ city: '横浜市', address: '中区山下町1' });
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

describe('公開表示の住所（formatFacilityLocality / formatFacilityAddress）', () => {
  it('大阪市の区は「大阪市」を補って正しい住所に戻す', () => {
    expect(formatFacilityLocality('大阪府', '北区')).toBe('大阪市北区');
    expect(formatFacilityAddress({ prefecture: '大阪府', city: '北区', address: '梅田1' })).toBe('大阪府大阪市北区梅田1');
  });

  it('正規化してから表示すると、元の住所と同じになる（大阪市北区 → 北区 → 大阪市北区）', () => {
    const stored = normalizeFacilityLocation({ prefecture: '大阪府', city: '大阪市北区', address: '大阪府大阪市北区梅田1-1' });
    expect(formatFacilityAddress({ prefecture: '大阪府', ...stored })).toBe('大阪府大阪市北区梅田1-1');
  });

  it('大阪府以外の同名の区・大阪府の他の市・区でない値はそのまま', () => {
    expect(formatFacilityLocality('東京都', '北区')).toBe('北区');
    expect(formatFacilityLocality('大阪府', '堺市')).toBe('堺市');
    expect(formatFacilityLocality('大阪府', '豊中市')).toBe('豊中市');
    expect(formatFacilityLocality(null, '北区')).toBe('北区');
    expect(formatFacilityAddress({ prefecture: '神奈川県', city: '横浜市', address: '中区山下町1' })).toBe('神奈川県横浜市中区山下町1');
  });

  it('旧データ（大阪市北区のまま保存された施設）も二重にしない', () => {
    expect(formatFacilityAddress({ prefecture: '大阪府', city: '大阪市中央区', address: '難波1-2-3' })).toBe('大阪府大阪市中央区難波1-2-3');
  });

  it('null は空文字として扱い「null」を出さない', () => {
    expect(formatFacilityLocality('大阪府', null)).toBe('');
    expect(formatFacilityAddress({ prefecture: null, city: undefined, address: null })).toBe('');
  });

  it('大阪市の全区で「大阪市」を補う', () => {
    for (const ward of OSAKA_CITY_WARDS) expect(formatFacilityLocality('大阪府', ward)).toBe(`${OSAKA_CITY}${ward}`);
  });
});

describe('SQL 版（public.normalize_facility_location）との一致と配線', () => {
  const normalizer = latestDefinition('normalize_facility_location');

  it('政令指定都市と大阪市の区の表が TypeScript 版と同じ', () => {
    expect(sqlArray(normalizer.sql, 'designated_cities').sort()).toEqual([...DESIGNATED_CITIES].sort());
    expect(sqlArray(normalizer.sql, 'osaka_wards').sort()).toEqual([...OSAKA_CITY_WARDS].sort());
  });

  it.each(['setup_facility_from_registration', 'link_duplicate_registration'])(
    '最新の %s が正規化を通している（その関数の本文の中で）',
    (fn) => {
      expect(latestDefinition(fn).body).toMatch(NORMALIZER_CALL);
    },
  );

  it('負の対照：link の本文から呼び出しを消すと検査が落ちる（後続の setup の呼び出しで通らない）', () => {
    const { sql, body } = latestDefinition('link_duplicate_registration');
    const removed = sql.replace(body, body.replace(new RegExp(NORMALIZER_CALL.source, 'g'), '-- removed '));
    expect(removed).not.toBe(sql);
    // 定義の先頭からファイル末尾までを見る旧来の検査は、同じ migration の後続関数の呼び出しで通ってしまう。
    expect(removed.slice(removed.search(definitionPattern('link_duplicate_registration')))).toMatch(NORMALIZER_CALL);
    // 本文に限った検査は落ちる。
    expect(functionBody(removed, 'link_duplicate_registration')).not.toMatch(NORMALIZER_CALL);
  });

  it('REVOKE / GRANT だけの記述は定義として数えない', () => {
    expect(definitionPattern('save_admin_menu_atomic').test('REVOKE ALL ON FUNCTION public.save_admin_menu_atomic(uuid) FROM PUBLIC;')).toBe(false);
    expect(definitionPattern('save_admin_menu_atomic').test('CREATE OR REPLACE FUNCTION public.save_admin_menu_atomic(')).toBe(true);
    expect(definitionPattern('save_admin_menu_atomic').test('CREATE FUNCTION public.save_admin_menu_atomic(')).toBe(true);
  });

  it('施設作成は正規化した city / address を facility_profiles へ書く', () => {
    const { body } = latestDefinition('setup_facility_from_registration');
    expect(body).toContain('new_prefecture,normalized_location.city,normalized_location.address,');
    expect(body).not.toMatch(/coalesce\(nullif\(p_profile->>'address',''\),receipt\.address,''\),\s*receipt\.postal_code/);
  });
});

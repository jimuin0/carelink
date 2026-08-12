/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * `facility_card_view` に対して参照している列が、実在する列だけであることを固定する
 * （2026年8月12日 新設）。
 *
 * 🔴 【なぜ必要か＝実際に起きた無音全滅】かつて `nearest_station` は view に射影されておらず、
 * キーワード検索の `.or()` がこれを参照していた。PostgREST は存在しない列に 400 を返すが、
 * 呼び出し側は error を握り潰して空配列を返していたため【キーワード検索が常に0件】になり、
 * 例外もログも出ないまま主要導線が死んでいた（migration 20260722000002 で view に射影して解消）。
 *
 * この事故は「列名を間違えた」ではなく「テーブルには在るが view には無い列を参照した」形。
 * `database.types.ts` は各 Supabase クライアントに配線されていないので tsc では防げず、
 * schema-snapshot.json と突き合わせるしか事前に検出する方法が無い。
 *
 * 【検査の射程】facilities.ts が view に対して使う
 *   ・select する列（CARD_COLS ＋ GPS 検索時の追加列）
 *   ・キーワード検索の `.ilike` 対象列
 *   ・searchFacilities 内の並び替え列
 * を対象にする。`.eq()/.gte()` 等は同ファイルが他テーブルにも投げており、
 * 静的には対象テーブルを判別できないため含めない（誤検知で信用を落とすより射程を明示する）。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const SRC = readFileSync(join(ROOT, 'src/lib/facilities.ts'), 'utf8');
const VIEW_COLUMNS: string[] = JSON.parse(
  readFileSync(join(ROOT, 'src/lib/schema-snapshot.json'), 'utf8')
).facility_card_view;

/** `const CARD_COLS = 'a, b, c';` の列。 */
function cardCols(): string[] {
  const m = /const CARD_COLS\s*=\s*'([^']+)'/.exec(SRC);
  if (!m) throw new Error('CARD_COLS を抽出できなかった（定義の書き方が変わった可能性）');
  return m[1].split(',').map((c) => c.trim()).filter(Boolean);
}

/** GPS 検索でのみ足す列（`${CARD_COLS}, latitude, longitude` の後半）。 */
function geoExtraCols(): string[] {
  const m = /`\$\{CARD_COLS\}, ([^`]+)`/.exec(SRC);
  if (!m) throw new Error('GPS 検索の追加列を抽出できなかった');
  return m[1].split(',').map((c) => c.trim()).filter(Boolean);
}

/** キーワード検索の `.or()` が ilike する列。 */
function ilikeCols(): string[] {
  return [...SRC.matchAll(/(\w+)\.ilike\./g)].map((m) => m[1]);
}

/** searchFacilities 内で view に対して指定する並び替え列。 */
function orderCols(): string[] {
  const start = SRC.indexOf('export async function searchFacilities');
  const end = SRC.indexOf('\nexport ', start + 1);
  const body = SRC.slice(start, end > start ? end : undefined);
  return [...body.matchAll(/query\.order\('(\w+)'/g)].map((m) => m[1]);
}

describe('facility_card_view の列参照', () => {
  it('スナップショットから view の列を取得できている（空振り防止）', () => {
    expect(Array.isArray(VIEW_COLUMNS)).toBe(true);
    expect(VIEW_COLUMNS.length).toBeGreaterThan(10);
  });

  it('抽出そのものが機能している（空振り防止）', () => {
    expect(cardCols().length).toBeGreaterThanOrEqual(20);
    expect(geoExtraCols()).toEqual(['latitude', 'longitude']);
    // 事故の当事者である nearest_station を含む 6 列
    expect(ilikeCols().length).toBeGreaterThanOrEqual(6);
    expect(ilikeCols()).toContain('nearest_station');
    expect(orderCols().length).toBeGreaterThanOrEqual(3);
  });

  it('select する列がすべて view に実在する', () => {
    const missing = [...cardCols(), ...geoExtraCols()].filter((c) => !VIEW_COLUMNS.includes(c));
    expect(missing).toEqual([]);
  });

  it('キーワード検索が ilike する列がすべて view に実在する（無音全滅の再発防止）', () => {
    const missing = ilikeCols().filter((c) => !VIEW_COLUMNS.includes(c));
    expect(missing).toEqual([]);
  });

  it('並び替え列がすべて view に実在する', () => {
    const missing = orderCols().filter((c) => !VIEW_COLUMNS.includes(c));
    expect(missing).toEqual([]);
  });

  it('CARD_COLS に重複が無い（PostgREST の select が冗長にならない）', () => {
    const cols = cardCols();
    expect(new Set(cols).size).toBe(cols.length);
  });

  // 負の対照: 判定そのものが「常に空配列」を返していないこと。
  it('view に無い列は検出される', () => {
    const planted = ['id', 'no_such_column_xyz'];
    expect(planted.filter((c) => !VIEW_COLUMNS.includes(c))).toEqual(['no_such_column_xyz']);
  });
});

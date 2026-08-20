/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * `/api/salons` の GET が匿名に返してよい列を絞る許可リスト
 * （`src/app/api/salons/route.ts` の `PUBLIC_SALON_COLUMNS`）の中身を機械で固定する
 * （2026年8月20日 新設）。
 *
 * 🔴 【なぜ必要か】`salons` には `email` / `phone` / `contact_phone` / `contact_name` /
 * `representative_name`（登録者PII）や `is_public` / `status`（内部情報）が含まれるが、
 * これらを許可リストへ載せない判断は route.ts のコメントに書かれているだけで、
 * それを固定するテストが1本も存在しなかった（`grep -rn "PUBLIC_SALON"` の結果はコード3箇所のみ）。
 * 列を1つ足しても CI は何も言わない状態だった。
 *
 * 検査は3方向:
 *   1. PII/内部情報の台帳が1つでも許可リストに入っていないか（漏洩防止）
 *   2. 許可リストの列が schema-snapshot.json の salons に実在するか
 *      （存在しない列を select すると PostgREST 400 → error 握り潰しで無音全滅する。
 *       このリポジトリで実際に起きた事故＝CLAUDE.md「facility_card_view」の教訓と同型）
 *   3. 抽出そのものが空振りしていないか（空集合のまま緑になる状態を作らない）
 *
 * 同種のガードの書き方は `stock-image-guard-wiring.test.ts` と `card-view-columns.test.ts` を手本にした。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const ROUTE_SRC = readFileSync(join(ROOT, 'src/app/api/salons/route.ts'), 'utf8');
const SALON_SCHEMA_COLUMNS: string[] = JSON.parse(
  readFileSync(join(ROOT, 'src/lib/schema-snapshot.json'), 'utf8')
).salons;

/**
 * `const PUBLIC_SALON_COLUMNS = '...' + '...' + '...';` のように文字列連結で
 * 複数行にまたがって定義されていても対応するため、定義全体（`=` 〜 終端の `;`）を
 * まず抜き出し、その範囲内の全ての単引用符文字列リテラルを連結してから列名に分割する。
 */
function extractPublicSalonColumns(): string[] {
  const defMatch = /const PUBLIC_SALON_COLUMNS\s*=([\s\S]*?);/.exec(ROUTE_SRC);
  if (!defMatch) {
    throw new Error('PUBLIC_SALON_COLUMNS の定義を抽出できなかった（定義の書き方が変わった可能性）');
  }
  const literals = [...defMatch[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const joined = literals.join('');
  return joined
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * PII として絶対に露出してはいけない列の台帳。
 * `salons` に実在する登録者PII（email/phone/contact_phone/contact_name/representative_name）と
 * 内部情報（is_public/status）を最低限含む。
 */
const FORBIDDEN_PUBLIC_COLUMNS = [
  'email',
  'phone',
  'contact_phone',
  'contact_name',
  'representative_name',
  'is_public',
  'status',
];

/**
 * 🔴 公開してよいと【人が実際に判断した】列の確定リスト。
 *
 * 台帳（FORBIDDEN_PUBLIC_COLUMNS）だけでは「次に足される PII」を守れない。
 * salons に将来 `owner_email` や `internal_note` のような列が増え、それが許可リストへ
 * 入っても、台帳に名前が載っていない限り検査は緑のまま通ってしまう。列挙は
 * 「今ある危険」しか守らないので、既定を逆にする＝**許可リストが1文字でも変われば必ず
 * 赤くする**。増やす側は、このリストを更新する時点で「匿名に見せてよいか」を必ず一度
 * 考えることになる（CLAUDE.md の remotePatterns ガードと同じ考え方）。
 */
const PINNED_PUBLIC_COLUMNS = [
  'id',
  'facility_name',
  'business_type',
  'address',
  'building_name',
  'nearest_station',
  'business_hours',
  'regular_holiday',
  'seat_count',
  'staff_count',
  'has_parking',
  'features',
  'pr_text',
  'photo_url',
  'photo_urls',
  'website',
  'postal_code',
  'created_at',
];

describe('PUBLIC_SALON_COLUMNS（/api/salons の公開許可リスト）', () => {
  it('許可リストが確定リストと完全一致する（列を足すことも消すことも必ず赤にする）', () => {
    expect(extractPublicSalonColumns()).toEqual(PINNED_PUBLIC_COLUMNS);
  });

  it('抽出そのものが機能している（空振り防止）', () => {
    const cols = extractPublicSalonColumns();
    // 現在の実測は18列（id, facility_name, business_type, address, building_name,
    // nearest_station, business_hours, regular_holiday, seat_count, staff_count,
    // has_parking, features, pr_text, photo_url, photo_urls, website, postal_code, created_at）。
    // 将来列が増減しても抽出そのものが壊れていないことを検出できるよう、実測より少し小さい
    // 下限を置く（拡張の余地を潰さない一方、正規表現が壊れて空集合になる事態は必ず検出する）。
    expect(cols.length).toBeGreaterThanOrEqual(10);
  });

  it('salons スキーマから列を取得できている（空振り防止）', () => {
    expect(Array.isArray(SALON_SCHEMA_COLUMNS)).toBe(true);
    expect(SALON_SCHEMA_COLUMNS.length).toBeGreaterThan(10);
    // 台帳の前提: PII/内部情報の列が実際に salons テーブルに存在すること
    // （存在しない列を「守っている」つもりになる自己欺瞞を防ぐ）。
    for (const forbidden of FORBIDDEN_PUBLIC_COLUMNS) {
      expect(SALON_SCHEMA_COLUMNS).toContain(forbidden);
    }
  });

  it('PII・内部情報の台帳の列が1つも許可リストに入っていない', () => {
    const cols = extractPublicSalonColumns();
    const leaked = FORBIDDEN_PUBLIC_COLUMNS.filter((c) => cols.includes(c));
    expect(leaked).toEqual([]);
  });

  it('許可リストの列がすべて salons テーブルに実在する（存在しない列の select による無音全滅の防止）', () => {
    const cols = extractPublicSalonColumns();
    const missing = cols.filter((c) => !SALON_SCHEMA_COLUMNS.includes(c));
    expect(missing).toEqual([]);
  });

  it('許可リストに重複が無い（PostgREST の select が冗長にならない）', () => {
    const cols = extractPublicSalonColumns();
    expect(new Set(cols).size).toBe(cols.length);
  });

  // 負の対照: 判定そのものが「常に空配列」を返していないこと。
  it('台帳判定は実際に検出できる（負の対照）', () => {
    const planted = ['id', 'email'];
    const leaked = FORBIDDEN_PUBLIC_COLUMNS.filter((c) => planted.includes(c));
    expect(leaked).toEqual(['email']);
  });

  it('確定リストの一致検査は実際に検出できる（負の対照）', () => {
    // 許可リストへ1列足した状態を模す。厳密一致なので必ず不一致になる。
    const planted = [...PINNED_PUBLIC_COLUMNS, 'internal_note'];
    expect(planted).not.toEqual(PINNED_PUBLIC_COLUMNS);
    // 1列消した状態も同様に検出できる（「消えても気づかない」を作らない）。
    expect(PINNED_PUBLIC_COLUMNS.slice(0, -1)).not.toEqual(PINNED_PUBLIC_COLUMNS);
  });

  it('実在チェックは実際に検出できる（負の対照）', () => {
    const planted = ['id', 'no_such_column_xyz'];
    const missing = planted.filter((c) => !SALON_SCHEMA_COLUMNS.includes(c));
    expect(missing).toEqual(['no_such_column_xyz']);
  });
});

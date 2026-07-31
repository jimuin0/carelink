import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 掲載0件のエリアページを検索エンジンへ出さない規則を、全階層で守らせる（2026年7月31日 新設）。
 *
 * 【何が起きていたか（本番実測）】
 * sitemap.ts には「施設が1件以上あるページのみ掲載（薄いコンテンツ除外）」という方針が
 * 明記され、都道府県×業種・市区町村×業種には実装されていた。しかし【その親である
 * 都道府県ページ・市区町村ページ・業種トップは無条件で全件掲載】されており、
 * 都道府県ページには noindex も付いていなかった。
 * 結果、sitemap のエリアURL 334 件のうち 328 件が施設0件のページだった。
 * ローンチ直後に空ページを大量に Google へ提出し、サイト全体の評価を下げる状態だった。
 *
 * 【なぜテストで縛るか】
 * 「1件ずつ気づいて直す」では、新しいエリア階層を足すたびに同じ漏れが再発する。
 * 規則の適用漏れをコードの形から機械的に検出する。
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** コメント行を除いた実コードだけを対象にする（説明文への誤ヒットを防ぐ）。 */
const codeOnly = (src: string) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

describe('sitemap は施設0件のエリアページを載せない', () => {
  const src = codeOnly(read('src/app/sitemap.ts'));

  // 各階層の URL 生成が、対応する「施設が存在する」Set で filter されていること。
  // Set 名と filter をセットで確認するので、Set を作っただけで使っていない死蔵も検出できる。
  it.each([
    ['都道府県ページ', 'prefecturePages', 'occupiedPref.has'],
    ['業種トップページ', 'businessTypeTopPages', 'occupiedType.has'],
    ['市区町村ページ', 'cityPages', 'occupiedCity.has'],
    ['都道府県×業種ページ', 'crossPages', 'occupiedPrefType.has'],
    ['市区町村×業種ページ', 'cityTypePages', 'occupiedCityType.has'],
  ])('%s（%s）が %s で絞り込まれている', (_label, varName, guard) => {
    const start = src.indexOf(`const ${varName}`);
    expect(start).toBeGreaterThan(-1);
    // 次の宣言までを当該ブロックとみなし、その中に filter があることを確かめる。
    const rest = src.slice(start + 1);
    const nextDecl = rest.search(/\n\s*const \w+(?:: MetadataRoute)?/);
    const block = nextDecl === -1 ? rest : rest.slice(0, nextDecl);
    expect(block).toContain('.filter(');
    expect(block).toContain(guard);
  });

  /**
   * 判定の材料は必ず本番データ（published な施設）から作る。
   * 固定リストを書くと、施設が増えても sitemap に載らない逆の事故になる。
   */
  it('掲載判定は published 施設の実データから作る', () => {
    expect(src).toContain("from('facility_profiles')");
    expect(src).toContain("eq('status', 'published')");
  });
});

describe('エリアページは掲載0件なら noindex にする', () => {
  // 階層が増えたらここに足す。どれか一つでも規則を外すと落ちる。
  const AREA_PAGES = [
    ['src/app/[prefectureSlug]/page.tsx', '都道府県'],
    ['src/app/[prefectureSlug]/[secondSlug]/page.tsx', '都道府県×業種／市区町村'],
    ['src/app/[prefectureSlug]/[secondSlug]/[typeSlug]/page.tsx', '市区町村×業種'],
  ] as const;

  it.each(AREA_PAGES)('%s（%s）が count===0 で noindex にする', (path) => {
    const src = codeOnly(read(path));
    expect(src).toMatch(/count === 0\s*\?\s*\{\s*robots:\s*\{\s*index:\s*false/);
  });

  /**
   * follow まで false にすると、0件ページから他エリアへの回遊リンクを辿ってもらえず、
   * 掲載が増えたときの再評価が遅れる。index だけ止めて follow は残す。
   */
  it.each(AREA_PAGES)('%s は follow: true を維持する', (path) => {
    const src = codeOnly(read(path));
    expect(src).toMatch(/index:\s*false,\s*follow:\s*true/);
  });

  /**
   * 件数は必ず問い合わせて数える。ハードコードや「常に noindex」に倒すと、
   * 掲載が増えてもインデックスされない逆の事故になる。
   */
  it.each(AREA_PAGES)('%s は件数を実データで数える', (path) => {
    const src = codeOnly(read(path));
    expect(src).toContain("count: 'exact'");
    expect(src).toContain("eq('status', 'published')");
  });
});

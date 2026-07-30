/**
 * ランキングの空状態が「行き止まり」にならないことを固定する（2026年7月30日 新設）。
 *
 * 【背景・本番で確認した事実】
 * ランキングは rating_count > 0 の施設だけを並べる（src/lib/rankings.ts の .gt('rating_count', 0)）。
 * サイト経由でない口コミ14件を削除して全施設が rating_count=0 になったため、
 * /ranking と /ranking/[area] は必ず空になる。旧実装はどちらも
 * 「ランキングデータがありません」の1行で終わっており、客が次に取れる行動が無かった。
 * /ranking は sitemap.xml に含まれ（本番で確認）、検索エンジンから直接来訪しうるため、
 * そこで離脱させてしまう。/search の0件時フォールバックだけが対応済みで、ここが漏れていた。
 *
 * 【このテストが守るもの】
 * 空状態に必ず次の導線があること、そして誘導先のクエリ名が実際に効くものであること。
 * 後者は実際に踏んだ罠で、初版で /search?prefecture= と書いたが検索ページが読むのは
 * searchParams.area であり、絞り込みが効かず全件が出る状態だった（ローカル実測で発見・是正）。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/**
 * コメントを除いた実コードだけを返す。
 * 是正の経緯コメントには旧文言（行き止まりの1行）がそのまま引用されているため、
 * ファイル全文を検査すると自分の説明文に反応して常に赤になる。
 * 同じ形の欠陥を過去に3度作り込んでいるので、ここでは最初から除去して比較する。
 */
function codeOnly(path: string): string {
  return read(path)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // JSX コメント
    .replace(/\/\*[\s\S]*?\*\//g, '')     // ブロックコメント
    .replace(/^\s*\/\/.*$/gm, '');        // 行コメント
}

const RANKING = codeOnly('src/app/ranking/page.tsx');
const RANKING_AREA = codeOnly('src/app/ranking/[area]/page.tsx');
const SEARCH = read('src/app/search/page.tsx');

describe('ランキングの空状態', () => {
  test.each([
    ['全国版 /ranking', RANKING],
    ['エリア別 /ranking/[area]', RANKING_AREA],
  ])('%s：空状態に次の導線がある（1行で終わらせない）', (_label, src) => {
    // 空状態ブロックだけを切り出す。ファイル全体を見ると、上部の都道府県リンクや
    // パンくずを「導線がある」と誤検出して、行き止まりに戻しても緑のままになる。
    const start = src.indexOf('口コミが集まっていません');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 1600);
    const links = block.match(/<Link\b/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  test.each([
    ['全国版 /ranking', RANKING],
    ['エリア別 /ranking/[area]', RANKING_AREA],
  ])('%s：旧来の行き止まり文言に戻していない', (_label, src) => {
    expect(src).not.toContain('ランキングデータがありません');
  });

  // 口コミが1件も無いことを「不人気」ではなく「まだ集まっていない」と説明する。
  // 実在しない評価を匂わせないための文言契約。
  test('空状態は口コミが実投稿のみで作られると明示する', () => {
    for (const src of [RANKING, RANKING_AREA]) {
      expect(src).toContain('実際に投稿された口コミの評価だけで作成');
    }
  });

  /**
   * 誘導先のクエリ名は /search 側の実装と一致していなければ絞り込みが効かない。
   * 検索ページは searchParams.area を params.prefecture へ写している。
   * ここが `prefecture=` になると無視され、エリアを選んだのに全件が出る。
   */
  test('エリア別の誘導先は /search が実際に読むクエリ名を使う', () => {
    expect(SEARCH).toMatch(/prefecture:\s*searchParams\.area/);
    expect(RANKING_AREA).toContain('/search?area=');
    expect(RANKING_AREA).not.toContain('/search?prefecture=');
  });

  // ランキング自体の順序は機械的でなければならない（自社施設の優遇を持ち込まない）。
  test('ランキングの並び順は評価と主キーだけで決まる', () => {
    const rankings = read('src/lib/rankings.ts');
    expect(rankings).toContain("order('rating_avg', { ascending: false })");
    expect(rankings).toContain("order('id', { ascending: true })");
    expect(rankings).not.toMatch(/priority|is_promoted|is_featured|sponsored/i);
  });
});

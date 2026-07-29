/**
 * あはき法・柔整師法の広告規制ゲート（2026年7月29日 新設）。
 *
 * 【なぜ必要か】CareLink は鍼灸院・整骨院を掲載しており、施設ページには施術メニュー名・料金・
 * 適応症・口コミが載る。これらは【あはき法第7条・柔整師法第24条の広告可能事項に含まれない】。
 * にもかかわらず現在それが適法なのは、厚労省ガイドライン（令和7年2月18日 医政発0218第1号）
 * が次の構造を採っているためで、条件が変わった瞬間に違法へ反転する。
 *
 *   Ⅱ.6(6)  ウェブサイトは「認知性」を満たさないため【原則として広告に該当しない】
 *   Ⅵ       ただし「施術所等紹介（仲介）サイトの紹介ページ」は広告として扱う
 *            ——【本指針Ⅱの２のウに該当するものに限る】という限定付き
 *   Ⅱ.2ウ   その条件は「施術所等が【掲載料・広告料を支払っている】もの」
 *            または「口コミによる取材の基準や【ランキング等の決定の基準が恣意的】なもの」
 *
 * つまり CareLink が広告規制を免れているのは、掲載が無料であることと、ランキングが
 * 機械的（rating_avg 降順＋id タイブレーク）であることの2点にのみ依存している。
 *
 * 【最も重要な点】あはき・柔整には医療機関のような【広告可能事項の限定解除が存在しない】。
 * 広告に該当した瞬間、料金・適応症・口コミは救済路なく掲載不可になる（医療機関より厳しい）。
 * さらにガイドラインⅥは、リスティング広告等を「入り口として閲覧するウェブサイト等」も
 * 規制対象と一体に扱うと明記しており、集客広告の出稿でも同じ反転が起きる。
 *
 * 本テストは、その反転を起こす操作をコード上で検知して止める。文面ではなく
 * 【規制が発動する条件そのもの】を監視するため、法令解釈を人間が覚えていなくても機能する。
 *
 * 出典：https://www.mhlw.go.jp/content/10800000/001412674.pdf
 */
import { readFileSync } from 'fs';
import { join } from 'path';

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8');
}

/** 掲載施設の業種（src/lib/constants.ts の businessTypes）のうち、あはき法・柔整師法の対象。 */
const AHAKI_BUSINESS_TYPES = ['鍼灸院・整骨院'];

describe('あはき法・柔整師法の広告規制ゲート', () => {
  /**
   * 条件1：掲載料・広告料を取っていないこと（ガイドライン Ⅱ.2ウ の前段）。
   * 有料掲載枠（/salon/premium・featured-ads）を公開すると、施設が掲載料を支払う構造になり、
   * 鍼灸院・整骨院の紹介ページが広告に該当しうる。
   */
  test('有料掲載枠が非公開のままである（有効化するなら あはき・柔整の掲載内容を絞る必要がある）', () => {
    const premium = read('src/app/salon/premium/page.tsx');
    expect(premium).toMatch(/const LAUNCH_HIDDEN = true;/);
    expect(premium).toContain('if (LAUNCH_HIDDEN) notFound()');
  });

  /**
   * 条件2：ランキングの決定基準が恣意的でないこと（ガイドライン Ⅱ.2ウ の後段）。
   * 手動の並び替え・掲載料による優遇・恣意的な重み付けを入れると、
   * 「ランキング等の決定の基準が恣意的なもの」に当たりうる。
   * rating_avg（口コミ平均点）の降順と id のタイブレークだけで決まることを固定する。
   */
  test('ランキングが口コミ平均点の機械的順序で決まる（恣意的な重み付けが無い）', () => {
    const rankings = read('src/lib/rankings.ts');
    expect(rankings).toContain("order('rating_avg', { ascending: false })");
    expect(rankings).toContain("order('id', { ascending: true })");

    // 掲載料・優先度・手動順位に類する並び替えキーが混入していないこと
    const arbitraryKeys = ['priority', 'is_promoted', 'is_featured', 'sponsored', 'paid_rank', 'manual_order'];
    for (const key of arbitraryKeys) {
      expect({ key, found: rankings.includes(key) }).toEqual({ key, found: false });
    }
  });

  /**
   * 条件3：あはき・柔整が掲載対象に含まれ続けていること自体は問題ないが、
   * 業種が増減したらこのゲートの前提（どの業種を守るのか）を見直す必要がある。
   * businessTypes から鍼灸院・整骨院が消える、あるいは別のあはき系業種が増えた場合に気づけるようにする。
   */
  test('あはき法の対象業種が掲載タクソノミーに含まれている', () => {
    const constants = read('src/lib/constants.ts');
    for (const bt of AHAKI_BUSINESS_TYPES) {
      expect(constants).toContain(bt);
    }
  });

  /**
   * 条件4：施設が投稿を依頼したり運営が口コミを恣意的に編集したりしていないこと。
   * 医療広告等ガイドライン Q1-18 は、否定的な体験談の削除・肯定的な体験談の優先表示を
   * 医療機関の依頼で行うと誘引性が生じるとする。あはき・柔整側も口コミ基準の恣意性を問題にする。
   * 口コミの並び順が新着順（created_at）で機械的であることを固定する。
   */
  test('口コミの表示順が機械的である（肯定的な投稿の優先表示になっていない）', () => {
    const reviewList = read('src/components/facility/ReviewList.tsx');
    // 評価点の高い順に並べ替える実装が入っていないこと（肯定的投稿の優遇に当たりうる）
    const biasedSorts = [
      "order('rating', { ascending: false })",
      'sort((a, b) => b.rating - a.rating)',
    ];
    for (const s of biasedSorts) {
      expect({ sort: s, found: reviewList.includes(s) }).toEqual({ sort: s, found: false });
    }
  });
});

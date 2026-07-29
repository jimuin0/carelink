/**
 * 利用規約の消費者契約法適合ガード（2026年7月29日 新設）。
 *
 * 【背景】利用規約に「当事業者は一切の責任を負いません」という【全部免除】の文言が2箇所あった。
 * 消費者契約法第8条第1項第1号・第3号は、事業者の損害賠償責任の全部を免除する条項を
 * 【過失の程度を問わず無効】と定めており、消費者庁の逐条解説（令和5年9月版）は
 * 「いかなる理由があっても一切損害賠償責任を負わない」を〔事例8-1〕として無効例に名指ししている。
 * 無効な条項を掲げることは、利用者に「請求できない」と誤信させて請求を抑制する点でも問題がある。
 *
 * 【なぜテストにするか】法務の知識は書いた本人の記憶にしか残らず、次に規約へ手を入れる人が
 * 同じ落とし穴に戻る。禁止パターンを機械可読な形で固定し、CI で止める。
 *
 * 参考（一次情報）：
 *   消費者契約法 https://laws.e-gov.go.jp/law/412AC0000000061
 *   逐条解説 第8条〜第10条
 *   https://www.caa.go.jp/policies/policy/consumer_system/consumer_contract_act/annotations
 */
import { readFileSync } from 'fs';
import { join } from 'path';

/** 利用者向けの規約系ページ。消費者契約法の審査を受けうる文書。 */
const CONSUMER_FACING_PAGES = [
  'src/app/terms/page.tsx',
  'src/app/privacy/page.tsx',
  'src/app/legal/page.tsx',
];

function readPage(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8');
}

describe('利用規約の消費者契約法適合', () => {
  /**
   * 全部免除（第8条1項1号・3号）。過失の程度を問わず無効なので、書いた時点で負け。
   * 「一部免除＋故意重過失を除く」形（逐条解説〔事例8-7〕）なら有効なので、
   * 「一切の」を伴う全部免除の言い回しだけを禁止する。
   */
  test('損害賠償責任を全部免除する文言が無い', () => {
    const forbidden = [
      '一切の責任を負い',
      '一切損害賠償',
      'いかなる場合も責任を負い',
      'いかなる理由があっても',
    ];
    for (const page of CONSUMER_FACING_PAGES) {
      const src = readPage(page);
      for (const ng of forbidden) {
        expect({ page, ng, found: src.includes(ng) }).toEqual({ page, ng, found: false });
      }
    }
  });

  /**
   * サルベージ条項（第8条3項・2023年6月1日施行）。
   * 「法律上許される限り」等の留保は、軽過失限定であることが一般的・平均的な消費者に
   * 明らかでないため無効（逐条解説〔事例8-19〕）。
   */
  test('サルベージ条項（法律で許される限り等の留保）が無い', () => {
    const forbidden = [
      '法律上許される限り',
      '法令で認められる範囲',
      '関連法令に反しない限り',
      '法律で許される範囲',
    ];
    for (const page of CONSUMER_FACING_PAGES) {
      const src = readPage(page);
      for (const ng of forbidden) {
        expect({ page, ng, found: src.includes(ng) }).toEqual({ page, ng, found: false });
      }
    }
  });

  /**
   * 自己判定型の免責・権限付与（第8条1項各号の「責任の有無を決定する権限を付与する条項」、
   * および第10条）。逐条解説〔事例8-11〕〔事例8-12〕が無効例として掲載している。
   * 最一判令和4年12月12日は、不明確な条項を裁判所が限定解釈して救うことはしないと判示した。
   */
  test('当事業者の自己判定で責任の有無を決める文言が無い', () => {
    const forbidden = [
      'と当事業者が認めた',
      'と当社が認めた',
      '当事業者が判断した場合に限り',
    ];
    for (const page of CONSUMER_FACING_PAGES) {
      const src = readPage(page);
      for (const ng of forbidden) {
        expect({ page, ng, found: src.includes(ng) }).toEqual({ page, ng, found: false });
      }
    }
  });

  /**
   * 免責を書く場合の受け皿。「責めに帰することができない事由」による限定（逐条解説〔事例8-4〕の
   * 確認的免責）が残っていることを固定し、うっかり無限定の免責へ戻る改変を検知する。
   */
  test('免責は「責めに帰することができない事由」に限定されている', () => {
    const terms = readPage('src/app/terms/page.tsx');
    const limitedCount = (terms.match(/責めに帰することができない事由/g) ?? []).length;
    expect(limitedCount).toBeGreaterThanOrEqual(2);

    // 当事業者自身の過失による責任まで免れるものではない旨の確認文が存在すること。
    expect(terms).toContain('責めに帰すべき事由により利用者に損害が生じた場合');
  });

  /**
   * 掲載者（事業者）との責任分担条項が、消費者である利用者の権利を奪うと誤読されないこと。
   * 消費者契約法は当事者ごとに適用が決まるため、BtoB条項がBtoCの権利を制限する体裁になっていると
   * 利用者の請求を不当に抑制する。
   */
  test('掲載者との責任分担が利用者の権利を制限しない旨が明記されている', () => {
    const terms = readPage('src/app/terms/page.tsx');
    expect(terms).toContain('利用者その他の第三者が当事業者に対して有する権利を制限するものではありません');
  });
});

/**
 * /salon の他社比較表が「施設が実際に使える機能」だけを ✅ にしていることを固定する（2026年7月29日 新設）。
 *
 * 【背景・実際に起きたこと】
 * 比較表は掲載を検討する施設に見せる約束であり、施設は「✅ なら自分の店で使える」と読む。
 * ところが Claude が「ソースファイルが存在する」ことだけを根拠に ✅ を正しいと報告し、
 * 神原さんの「LINE通知連携 機能してる？初耳やけど」で初めて誤りが判明した。
 * 本番の実データ・環境変数キー名で調べ直した結果、3つの ✅ が施設から使えなかった。
 *   - LINE通知連携：送信コードは booking / cancel / booking-status / booking-reminder に
 *     配線済みで、LINE_CHANNEL_ACCESS_TOKEN_CARELINK も設定済み。しかし NEXT_PUBLIC_LIFF_ID が
 *     未設定で顧客が連携する入口が無く、line_user_links 0件・line_notification_logs 0件＝
 *     本番で一度も送信されていなかった。ローンチに含めないと神原さんが決定。
 *   - 症状別検索（鍼灸院）：/symptom/[slug] の公開ページは実在し 30 症状のマスタもあるが、
 *     facility_symptoms へ書き込む管理UI・APIがアプリ全体で 0 件。施設は自分の対応症状を
 *     登録できず、症状ページに載りようが無かった（facility_symptoms 0件）。
 *   - 保険適用メニュー対応：施設ページに表示バッジ（MenuList.tsx）はあるが、
 *     insurance_covered を書き込む管理UI・APIが 0 件で施設は設定できなかった。
 *
 * 【このテストが守るもの】
 * 「表示側や DB 列があること」を根拠に ✅ を書き足す誤りを、CI で物理的に止める。
 * 判定は【施設が値を保存できる経路（管理API）があるか】で行い、双方向で固定する。
 *   - 書き込み経路が無いのに行がある → 落とす（虚偽の約束）
 *   - 書き込み経路を作ったのに行が無い → 追加を促す（機能を隠したまま）
 * これにより、管理画面を実装すれば行を復活させられ、その時だけ緑になる。
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const salonPage = readFileSync(join(root, 'src/app/salon/page.tsx'), 'utf8');

/** 管理APIレイヤ全体を1つの文字列に連結し、書き込み経路の有無を判定する材料にする。 */
function readAdminApiSources(): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(rel);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      chunks.push(readFileSync(join(root, rel), 'utf8'));
    }
  };
  walk('src/app/api/admin');
  walk('src/app/admin');
  return chunks.join('\n');
}

const adminSources = readAdminApiSources();

/**
 * 比較表の【データ配列だけ】を切り出す。
 * ファイル全体を対象にすると、行を落とした経緯を説明するコメント（機能名を含む）を
 * 「表に載っている」と誤判定し、ガードが常に緑になって意味を失う。
 * 実際に初版でこの誤りを作り込み、実行前に気づいて修正した（2026年7月29日）。
 */
function extractComparisonRows(): string {
  const start = salonPage.indexOf("['月額費用'");
  const end = salonPage.indexOf('].map(', start);
  if (start === -1 || end === -1) {
    throw new Error('比較表のデータ配列を特定できない。表の構造を変えたならこのテストも更新すること。');
  }
  return salonPage.slice(start, end);
}

const comparisonRows = extractComparisonRows();

/**
 * 比較表の行ラベル ↔ 施設がその機能の値を保存するために必ず触る識別子。
 * 識別子が管理レイヤに現れない＝施設は設定できない＝✅ を出してはいけない。
 */
const CLAIMS = [
  {
    label: '症状別検索（鍼灸院）',
    writeSignal: 'facility_symptoms',
    why: '施設が対応症状を登録できないと、症状ページの検索結果に載れない',
  },
  {
    label: '保険適用メニュー対応',
    writeSignal: 'insurance_covered',
    why: '施設が保険適用フラグを設定できないと、保険バッジは永久に出ない',
  },
];

describe('/salon 比較表の ✅ は施設が実際に使える機能だけ', () => {
  test.each(CLAIMS)('$label：書き込み経路の有無と行の有無が一致する', ({ label, writeSignal, why }) => {
    const hasWritePath = adminSources.includes(writeSignal);
    const isClaimed = comparisonRows.includes(label);

    if (isClaimed && !hasWritePath) {
      throw new Error(
        `比較表に「${label}」を ✅ として載せているが、管理レイヤに ${writeSignal} への書き込み経路が無い。` +
          `${why}。管理画面を実装するか、行を削除すること。`,
      );
    }
    if (!isClaimed && hasWritePath) {
      throw new Error(
        `${writeSignal} の書き込み経路を実装したのに、比較表に「${label}」の行が無い。` +
          '実装したなら行を戻し、page.tsx 内の経緯コメントも更新すること。',
      );
    }
    expect(isClaimed).toBe(hasWritePath);
  });

  // LINE は「書き込み経路」ではなく外部設定(NEXT_PUBLIC_LIFF_ID)が欠けている型のため、
  // 上の CLAIMS とは判定軸が違う。ローンチに含めない決定（2026年7月29日・神原さん）を固定する。
  test('LINE通知連携は比較表に載せない（LIFF未設定で顧客が連携できないため）', () => {
    expect(comparisonRows).not.toContain('LINE通知連携');
  });

  // 落とした理由をコードから消させない。理由が消えると、次の担当者が
  // 「なぜ無いのか」を調べられず、また安易に ✅ を書き足す。
  test('落とした3機能の経緯がコメントとして残っている', () => {
    for (const keyword of ['LINE通知連携', '症状別検索', '保険適用メニュー']) {
      expect(salonPage).toContain(keyword);
    }
    expect(salonPage).toContain('施設が管理画面から自分で設定でき');
  });

  // 残した ✅ が管理画面を伴うことを確認する（表示だけの機能を混ぜない）。
  test.each([
    ['クーポン管理', 'src/app/admin/coupons'],
    ['スタッフ管理', 'src/app/admin/staff'],
    ['売上分析', 'src/app/admin/analytics'],
  ])('%s は管理画面が実在する', (label, dir) => {
    expect(comparisonRows).toContain(label);
    expect(() => readdirSync(join(root, dir))).not.toThrow();
  });
});

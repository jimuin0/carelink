/**
 * プライバシーポリシーと実装の整合ガード（2026年7月29日 新設）。
 *
 * 【背景】プライバシーポリシーは「実際に取得している情報」を書く文書だが、機能の追加・再開に
 * 追従し忘れると【実態と乖離した記載】になる。特に危険なのが逆方向の乖離＝「取得していない」と
 * 書いてあるのに実際は取得している状態で、これは同意なき取得になりうる。
 *
 * 本テストは、その乖離を人間の記憶ではなく CI で捕まえる。文言の細部ではなく
 * 【機能フラグ ↔ ポリシー記載】の対応関係だけを固定するため、文章の言い回しを直しても壊れない。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { INTAKE_CUSTOMER_ENABLED } from '@/lib/intake-config';

const privacySource = readFileSync(
  join(process.cwd(), 'src/app/privacy/page.tsx'),
  'utf8',
);

describe('プライバシーポリシーと実装の整合', () => {
  /**
   * 問診（intake）は施設が任意の質問項目を作れる設計のため、鍼灸院・整骨院・美容クリニック等が
   * 症状や既往歴を尋ねれば【要配慮個人情報】の取得になる。顧客向けには現在 OFF（テンプレ0件・
   * 回答0件を本番実データで確認済み）で、ポリシーも「取得していない」と明記している。
   * 再開する際にポリシーを直し忘れると、健康情報を同意の裏付けなく集める状態になる。
   */
  test('問診を再開したらポリシーの要配慮個人情報の記載も更新されている', () => {
    const saysNotCollecting = privacySource.includes('要配慮個人情報」）を');
    const hasNotCollectingSentence = privacySource.includes('取得していません');

    if (INTAKE_CUSTOMER_ENABLED) {
      // 再開した以上「取得していない」とは書けない。取得する旨・目的・同意方法へ書き換えること。
      expect(
        saysNotCollecting && hasNotCollectingSentence,
      ).toBe(false);
    } else {
      // OFF の間は「取得していない」と明記されていること（記載自体の消失も検知する）。
      expect(hasNotCollectingSentence).toBe(true);
    }
  });

  /**
   * 個人データが渡る外部事業者は第5条に列挙する。実装で新しい外部サービスへ個人データを
   * 送り始めたのに列挙を忘れる、という乖離を防ぐ（Resend・Anthropic が実際に抜けていた）。
   */
  test('個人データが渡る外部事業者が第5条に列挙されている', () => {
    const required = [
      'Supabase',    // DB・認証
      'Vercel',      // ホスティング
      'Google',      // GA4・認証連携
      'Microsoft',   // Clarity
      'LINEヤフー',  // 認証連携・メッセージ配信
      'Resend',      // メール配信（氏名・メール・予約内容）
      'Anthropic',   // AI（利用者の入力文・公開済み口コミ本文）
    ];
    for (const vendor of required) {
      expect(privacySource).toContain(vendor);
    }
  });

  /** 条番号の重複・欠番を検知する（実際に第7条が2つ・第8条が欠番になっていた）。 */
  test('条番号が重複せず連番になっている', () => {
    const numbers = [...privacySource.matchAll(/第(\d+)条（/g)].map((m) => Number(m[1]));
    expect(numbers.length).toBeGreaterThan(0);

    const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    expect(duplicates).toEqual([]);

    const sorted = [...numbers].sort((a, b) => a - b);
    const expectedSeq = Array.from({ length: sorted.length }, (_, i) => i + 1);
    expect(sorted).toEqual(expectedSeq);
  });
});

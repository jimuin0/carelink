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
   * 問診（intake）は施設が任意の質問項目を作れる設計のため、症状や既往歴を尋ねれば
   * 【要配慮個人情報】の取得になる。2026年11月13日（神原さん決定・A87）に、問診の公開状態に
   * かかわらず「取得し得る」旨・利用目的・同意取得・提供範囲を明記する記載へ改めた。
   * 「取得していません」へ戻すと、問診を再開した瞬間に同意なき取得の記載になるので CI で止める。
   */
  test('要配慮個人情報を取得し得る旨・目的・同意・提供範囲が明記されている', () => {
    expect(privacySource).not.toContain('取得していません');
    expect(privacySource).toContain('要配慮個人情報');
    expect(privacySource).toContain('取得する場合があります');
    expect(privacySource).toContain('ご本人の同意を得たうえで取得');
    expect(privacySource).toContain('施術・診療の参考');
    expect(privacySource).toContain('予約・回答した施設');
    // 問診フラグを単一ソースから読んでいること（再開時もこの記載のまま成立する）
    expect(typeof INTAKE_CUSTOMER_ENABLED).toBe('boolean');
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

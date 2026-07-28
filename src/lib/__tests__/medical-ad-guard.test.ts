/**
 * 医療広告ガイドライン・あはき法の禁止表現ガード
 *
 * 誤検知（善意の文章を弾く）と見逃し（違法表現を通す）の両方が実害になるため、
 * 「弾くべき語」と「弾いてはいけない語」を両方固定する。
 */
import { findMedicalAdViolations, validateFacilityPrText } from '../medical-ad-guard';

describe('findMedicalAdViolations', () => {
  test('治療効果を保証する表現を検知する', () => {
    const v = findMedicalAdViolations('この施術で必ず治ります');
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].reason).toContain('治療効果を保証');
  });

  test('安全性を断定する表現を検知する', () => {
    expect(findMedicalAdViolations('絶対安全な施術です').length).toBeGreaterThan(0);
    expect(findMedicalAdViolations('副作用なしで受けられます').length).toBeGreaterThan(0);
  });

  test('比較優良を示す表現を検知する', () => {
    expect(findMedicalAdViolations('日本一の技術').length).toBeGreaterThan(0);
    expect(findMedicalAdViolations('地域No.1の実績').length).toBeGreaterThan(0);
    expect(findMedicalAdViolations('最先端の治療を提供').length).toBeGreaterThan(0);
  });

  test('重篤疾患への効果をうたう表現を検知する', () => {
    expect(findMedicalAdViolations('がんが消えると評判です').length).toBeGreaterThan(0);
  });

  test('費用の過度な強調を検知する', () => {
    expect(findMedicalAdViolations('今だけ半額').length).toBeGreaterThan(0);
    expect(findMedicalAdViolations('先着10名様').length).toBeGreaterThan(0);
  });

  // 【最重要】誤検知でまっとうな施設紹介・口コミを弾いてはいけない。
  test('通常の施設紹介・口コミは検知しない', () => {
    expect(findMedicalAdViolations('丁寧な施術で安心して通えます')).toEqual([]);
    expect(findMedicalAdViolations('駅から徒歩5分。土日も営業しています')).toEqual([]);
    expect(findMedicalAdViolations('肩こりが楽になりました。また利用します')).toEqual([]);
    expect(findMedicalAdViolations('スタッフの方が親切で、院内も清潔でした')).toEqual([]);
    expect(findMedicalAdViolations('国家資格を持つ施術者が担当します')).toEqual([]);
  });

  test('空・null・undefined は検知対象外', () => {
    expect(findMedicalAdViolations('')).toEqual([]);
    expect(findMedicalAdViolations(null)).toEqual([]);
    expect(findMedicalAdViolations(undefined)).toEqual([]);
  });

  test('複数の違反を全て返す', () => {
    const v = findMedicalAdViolations('日本一の技術で必ず治ります');
    expect(v.length).toBeGreaterThanOrEqual(2);
    expect(v.map((x) => x.term)).toEqual(expect.arrayContaining(['日本一', '必ず治り']));
  });
});

describe('validateFacilityPrText', () => {
  test('問題ない文言は ok を返す', () => {
    expect(validateFacilityPrText('地域に根ざした鍼灸院です')).toEqual({ ok: true });
  });

  test('空文字も ok（未入力を弾かない）', () => {
    expect(validateFacilityPrText('')).toEqual({ ok: true });
    expect(validateFacilityPrText(null)).toEqual({ ok: true });
  });

  test('違反時は該当語と理由を含むメッセージを返す', () => {
    const r = validateFacilityPrText('必ず治る施術');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('必ず治る');
      expect(r.message).toContain('医療広告ガイドライン');
    }
  });

  // 同一理由の語が複数当たっても、同じ説明文を繰り返さない（読みにくさの回避）。
  test('同じ理由は重複表示しない', () => {
    const r = validateFacilityPrText('日本一かつ世界一の技術');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const occurrences = r.message.split('他との比較優良').length - 1;
      expect(occurrences).toBe(1);
    }
  });
});

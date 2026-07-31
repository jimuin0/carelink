import {
  resolveFrom,
  isValidFrom,
  domainOf,
  DEFAULT_FROM,
  DEFAULT_FROM_DOMAIN,
  RESEND_VERIFIED_DOMAINS,
} from '@/lib/email-from';

describe('email-from.ts（送信元解決のSSOT）', () => {
  /**
   * 既定値そのものが未検証ドメインだと、フォールバック先が死んでいることになり
   * 「倒しても届かない」最悪の状態になる。この不変条件をテストで固定する。
   */
  it('既定の送信元は必ず検証済みドメインで構成される', () => {
    expect(RESEND_VERIFIED_DOMAINS).toContain(DEFAULT_FROM_DOMAIN);
    expect(domainOf(DEFAULT_FROM)).toBe(DEFAULT_FROM_DOMAIN);
    expect(isValidFrom(DEFAULT_FROM)).toBe(true);
  });

  describe('isValidFrom', () => {
    it.each([
      ['a@b.com', true],
      ['CareLink <noreply@carelink-jp.com>', true],
      ['carelink-jp.com', false], // @ が無い＝メールアドレスでない（本番で実際に起きた設定ミス）
      ['a@b', false], // TLD が無い
      ['', false],
    ])('%s → %s', (input, expected) => {
      expect(isValidFrom(input)).toBe(expected);
    });
  });

  describe('domainOf', () => {
    it.each([
      ['a@b.com', 'b.com'],
      ['CareLink <noreply@carelink-jp.com>', 'carelink-jp.com'],
      ['CareLink <noreply@CareLink-JP.com>', 'carelink-jp.com'], // 大小文字を正規化する
      ['no-at-sign', null],
    ])('%s → %s', (input, expected) => {
      expect(domainOf(input)).toBe(expected);
    });
  });

  describe('resolveFrom（本番）', () => {
    it('検証済みドメインならenv値をそのまま使う', () => {
      const r = resolveFrom('CareLink <yoyaku@carelink-jp.com>', true);
      expect(r.from).toBe('CareLink <yoyaku@carelink-jp.com>');
      expect(r.sendingDomain).toBe('carelink-jp.com');
      expect(r.fellBack).toBe(false);
      expect(r.domainOk).toBe(true);
    });

    it('未検証ドメイン(resend.dev)は既定値へ倒す', () => {
      const r = resolveFrom('CareLink <onboarding@resend.dev>', true);
      expect(r.from).toBe(DEFAULT_FROM);
      expect(r.sendingDomain).toBe(DEFAULT_FROM_DOMAIN);
      expect(r.fellBack).toBe(true);
      expect(r.formatOk).toBe(true);
      expect(r.domainOk).toBe(false);
      expect(r.rawDomain).toBe('resend.dev'); // 診断用に生値のドメインは保持する
    });

    it('形式不正は既定値へ倒す', () => {
      const r = resolveFrom('carelink-jp.com', true);
      expect(r.from).toBe(DEFAULT_FROM);
      expect(r.formatOk).toBe(false);
      expect(r.rawDomain).toBeNull();
    });

    it('未設定(undefined)は既定値になる', () => {
      const r = resolveFrom(undefined, true);
      expect(r.from).toBe(DEFAULT_FROM);
      expect(r.raw).toBe(DEFAULT_FROM);
      expect(r.fellBack).toBe(false); // 既定値自体は妥当なのでフォールバック扱いにしない
    });

    it('空文字は未設定と同じ扱いにする（env の空指定で送信全滅にしない）', () => {
      expect(resolveFrom('', true).from).toBe(DEFAULT_FROM);
    });
  });

  describe('resolveFrom（非本番）', () => {
    it('未検証ドメインでもenv値を尊重する（サンドボックス送信を壊さない）', () => {
      const r = resolveFrom('CareLink <onboarding@resend.dev>', false);
      expect(r.from).toBe('CareLink <onboarding@resend.dev>');
      expect(r.sendingDomain).toBe('resend.dev');
      expect(r.fellBack).toBe(false);
    });

    it('形式不正は非本番でも既定値へ倒す（typoでResend 422にしない）', () => {
      const r = resolveFrom('carelink-jp.com', false);
      expect(r.from).toBe(DEFAULT_FROM);
      expect(r.fellBack).toBe(true);
    });
  });
});

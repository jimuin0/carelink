import {
  fromEnv,
  newsletterFromEnv,
  productionResolvedFrom,
  resolvedFromEnv,
  DEFAULT_NEWSLETTER_FROM,
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

/**
 * env を読む入口はここだけ。cron やニュースレターが自前で env を組み立てて
 * ガードを迂回していた事故（2026年7月31日）の再発を、各入口の挙動で固定する。
 */
describe('env から解決する入口', () => {
  const ORIGINAL = { from: process.env.EMAIL_FROM, news: process.env.NEWSLETTER_EMAIL_FROM, node: process.env.NODE_ENV };
  const setNodeEnv = (v: string) => Object.defineProperty(process.env, 'NODE_ENV', { value: v, configurable: true });

  afterEach(() => {
    if (ORIGINAL.from === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = ORIGINAL.from;
    if (ORIGINAL.news === undefined) delete process.env.NEWSLETTER_EMAIL_FROM; else process.env.NEWSLETTER_EMAIL_FROM = ORIGINAL.news;
    setNodeEnv(ORIGINAL.node as string);
  });

  it('fromEnv は本番の未検証ドメインを既定値へ倒す', () => {
    setNodeEnv('production');
    process.env.EMAIL_FROM = 'CareLink <onboarding@resend.dev>';
    expect(fromEnv()).toBe(DEFAULT_FROM);
  });

  it('fromEnv は本番の検証済みドメインをそのまま使う', () => {
    setNodeEnv('production');
    process.env.EMAIL_FROM = 'CareLink 予約 <yoyaku@carelink-jp.com>';
    expect(fromEnv()).toBe('CareLink 予約 <yoyaku@carelink-jp.com>');
  });

  it('resolvedFromEnv は診断情報つきで返す（email.ts のアラート判定に使う）', () => {
    setNodeEnv('production');
    process.env.EMAIL_FROM = 'CareLink <onboarding@resend.dev>';
    const r = resolvedFromEnv();
    expect(r.fellBack).toBe(true);
    expect(r.rawDomain).toBe('resend.dev');
    expect(r.domainOk).toBe(false);
  });

  /**
   * ニュースレターも同じ検証を通す。ここが素通りだと、購読者への配信だけが
   * 未検証ドメインで丸ごと不達になる（同じ穴が別経路に残る）。
   */
  it('newsletterFromEnv は未検証ドメインの指定を既定値へ倒す', () => {
    setNodeEnv('production');
    process.env.NEWSLETTER_EMAIL_FROM = 'CareLink <news@resend.dev>';
    expect(newsletterFromEnv()).toBe(DEFAULT_FROM);
  });

  it('newsletterFromEnv は未設定なら検証済みの専用アドレスを使う', () => {
    setNodeEnv('production');
    delete process.env.NEWSLETTER_EMAIL_FROM;
    expect(newsletterFromEnv()).toBe(DEFAULT_NEWSLETTER_FROM);
    expect(domainOf(DEFAULT_NEWSLETTER_FROM)).toBe(DEFAULT_FROM_DOMAIN);
  });

  it('newsletterFromEnv は検証済みドメインの指定を尊重する', () => {
    setNodeEnv('production');
    process.env.NEWSLETTER_EMAIL_FROM = 'CareLink おしらせ <info@carelink-jp.com>';
    expect(newsletterFromEnv()).toBe('CareLink おしらせ <info@carelink-jp.com>');
  });

  it('newsletterFromEnv は非本番では env 値を尊重する（サンドボックス送信）', () => {
    setNodeEnv('test');
    process.env.NEWSLETTER_EMAIL_FROM = 'CareLink <news@resend.dev>';
    expect(newsletterFromEnv()).toBe('CareLink <news@resend.dev>');
  });

  /** 監視は常に本番基準で見る。開発の値で緑にすると設定ミスを見逃す。 */
  it('productionResolvedFrom は非本番実行でも本番基準で解決する', () => {
    setNodeEnv('test');
    process.env.EMAIL_FROM = 'CareLink <onboarding@resend.dev>';
    expect(productionResolvedFrom().sendingDomain).toBe(DEFAULT_FROM_DOMAIN);
  });

  /**
   * 監視が「倒れた事実」を見分けられることを固定する。ドメインだけを返していた頃は、
   * 未検証ドメインでも倒れた先が検証済みなので監視が必ず緑になり、設定ミスが隠れた。
   */
  it('productionResolvedFrom は EMAIL_FROM の設定ミスを fellBack で見分けられる', () => {
    setNodeEnv('test');
    process.env.EMAIL_FROM = 'CareLink <onboarding@resend.dev>';
    expect(productionResolvedFrom().fellBack).toBe(true);
    process.env.EMAIL_FROM = 'CareLink <noreply@carelink-jp.com>';
    expect(productionResolvedFrom().fellBack).toBe(false);
  });

  it('EMAIL_FROM 未設定は誤設定ではない（既定値が妥当なので fellBack しない）', () => {
    setNodeEnv('test');
    delete process.env.EMAIL_FROM;
    expect(productionResolvedFrom().fellBack).toBe(false);
  });
});

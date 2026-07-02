import { encryptUnsubEmail, decryptUnsubEmail, newsletterUnsubUrl } from '@/lib/newsletter-unsub';

describe('newsletter-unsub 暗号化トークン（メールを URL に露出しない）', () => {
  const ORIGINAL = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  beforeAll(() => {
    process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = 'test-secret-for-unsub-aes-gcm';
  });
  afterAll(() => {
    // undefined を代入すると文字列 "undefined" が残り他テストを汚染するため delete で復元する。
    if (ORIGINAL === undefined) delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    else process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = ORIGINAL;
  });

  it('暗号化→復号でメールが一致する（ラウンドトリップ）', () => {
    const token = encryptUnsubEmail('user@example.com');
    expect(decryptUnsubEmail(token)).toBe('user@example.com');
  });

  it('大文字は小文字に正規化される', () => {
    const token = encryptUnsubEmail('User@Example.COM');
    expect(decryptUnsubEmail(token)).toBe('user@example.com');
  });

  it('毎回 IV がランダムで暗号文は変わるが、どちらも同じメールに復号される', () => {
    const t1 = encryptUnsubEmail('user@example.com');
    const t2 = encryptUnsubEmail('user@example.com');
    expect(t1).not.toBe(t2);
    expect(decryptUnsubEmail(t1)).toBe('user@example.com');
    expect(decryptUnsubEmail(t2)).toBe('user@example.com');
  });

  it('改ざんされたトークンは null（GCM 認証タグで検知）', () => {
    const token = encryptUnsubEmail('user@example.com');
    // 先頭文字（IV 領域・base64url パディングビット非依存）を書き換えて IV を破壊する。
    // 末尾改ざんは token 長 % 4 == 3 のとき最終 base64url 文字が
    // パディングビットのみを含む場合があり、デコード後バイト列が変わらず
    // GCM 検証が通ってしまうフレーキーが発生する（token.length=59 の場合に再現）。
    const tampered = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
    expect(decryptUnsubEmail(tampered)).toBeNull();
  });

  it('不正な形式のトークンは null', () => {
    expect(decryptUnsubEmail('')).toBeNull();
    expect(decryptUnsubEmail('not-a-valid-token')).toBeNull();
    expect(decryptUnsubEmail('AAAA')).toBeNull(); // iv+tag+ct 未満
  });

  it('NEWSLETTER_UNSUBSCRIBE_SECRET 未設定なら暗号化は throw する（fail-closed）', () => {
    const saved = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    try {
      expect(() => encryptUnsubEmail('user@example.com')).toThrow('NEWSLETTER_UNSUBSCRIBE_SECRET is not set');
    } finally {
      process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = saved;
    }
  });

  it('NEWSLETTER_UNSUBSCRIBE_SECRET 未設定時の復号は null かつ設定不備を error ログで可視化（D-5・改ざんと区別）', () => {
    const saved = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    try {
      // 復号は安全側（列挙攻撃防止の null）を維持しつつ、鍵未設定は改ざんと違い error で可視化する。
      expect(decryptUnsubEmail('any-token-value')).toBeNull();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('NEWSLETTER_UNSUBSCRIBE_SECRET is not set'),
      );
    } finally {
      if (saved === undefined) delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
      else process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = saved;
      errSpy.mockRestore();
    }
  });

  it('配信停止 URL は不透明トークンのみで、メール/「email=」を一切含まない（PII 非露出の回帰）', () => {
    const url = newsletterUnsubUrl('Secret.User@example.com');
    expect(url).toContain('/unsubscribe?n=');
    expect(url).not.toContain('email=');
    expect(url).not.toContain('@');
    expect(url.toLowerCase()).not.toContain('secret.user');
    // n パラメータを取り出して復号すると元メール（正規化済み）に戻る。
    const n = new URL(url).searchParams.get('n')!;
    expect(decryptUnsubEmail(n)).toBe('secret.user@example.com');
  });
});

import {
  MERCHANT_GUIDE_SLUG,
  isMerchantGuide,
  tokenizeMerchantInline,
} from '../merchant-guide';

describe('merchant guide scope', () => {
  it('uses reviewed slugs only', () => {
    expect(isMerchantGuide(MERCHANT_GUIDE_SLUG)).toBe(true);
    expect(isMerchantGuide('salon-booking-funnel-checklist')).toBe(true);
    for (const slug of ['', 'customer-guide', `${MERCHANT_GUIDE_SLUG}-extra`, '__proto__']) {
      expect(isMerchantGuide(slug)).toBe(false);
    }
  });
});

describe('tokenizeMerchantInline', () => {
  it('preserves empty/plain text and incomplete markup', () => {
    expect(tokenizeMerchantInline('')).toEqual([]);
    for (const text of ['料金を確認', '**unfinished', '[no-close', '[x](/register']) {
      expect(tokenizeMerchantInline(text)).toEqual([{ type: 'text', text }]);
    }
  });

  it('preserves prefix/suffix and adjacent tokens', () => {
    expect(tokenizeMerchantInline('前**大切**[条件](/terms)後')).toEqual([
      { type: 'text', text: '前' },
      { type: 'strong', text: '大切' },
      { type: 'link', text: '条件', href: '/terms' },
      { type: 'text', text: '後' },
    ]);
  });

  it.each(['/register', '/terms', '/legal', 'https://salonboard.com/faq/'])('permits reviewed URL %s', (href) => {
    expect(tokenizeMerchantInline(`[案内](${href})`)).toEqual([{ type: 'link', text: '案内', href }]);
  });

  it.each([
    'javascript:alert(1)', 'data:text/html,x', '//evil.test', '/\\evil.test',
    'https://salonboard.com.evil.test/faq/', 'https://salonboard.com@evil.test/faq/',
    '/register?utm_source=internal', '/register#unreviewed', '/%2f%2fevil.test',
    '/admin', 'https://evil.test', 'https://salonboard.com/faq/?x=1',
  ])('keeps unapproved links as literal text: %s', (href) => {
    const text = `[案内](${href})`;
    const tokens = tokenizeMerchantInline(text);
    expect(tokens.some((token) => token.type === 'link')).toBe(false);
    expect(tokens.map((token) => token.text).join('')).toBe(text);
  });

  it('does not turn HTML into executable markup', () => {
    const text = '<img src=x onerror=alert(1)><script>bad()</script>';
    expect(tokenizeMerchantInline(text)).toEqual([{ type: 'text', text }]);
  });
});

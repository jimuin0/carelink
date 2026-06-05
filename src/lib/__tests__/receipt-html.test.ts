/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/receipt-html.ts（領収書HTML生成・決済プロバイダ非依存）
 */
import { buildReceiptHtml, escapeHtml } from '../receipt-html';

describe('escapeHtml', () => {
  test('HTML特殊文字をエスケープ', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
  test('null/undefined → 空文字', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('buildReceiptHtml', () => {
  const base = {
    receiptNo: 'CL-ABC12345', issuedDate: '2026年5月10日', amount: 5000,
    itemLabel: '施術料金', paymentId: 'ch_1',
  };

  test('施設情報（住所・電話あり）を含む領収書', () => {
    const html = buildReceiptHtml({ ...base, facility: { name: 'Salon', postal_code: '150-0001', prefecture: '東京都', city: '渋谷区', address: '1-1', phone: '03-0000' } });
    expect(html).toContain('領　収　書');
    expect(html).toContain('CL-ABC12345');
    expect(html).toContain('¥5,000');
    expect(html).toContain('〒150-0001');
    expect(html).toContain('TEL: 03-0000');
    expect(html).toContain('ch_1');
    // 消費税 10% 内税
    expect(html).toContain('¥455'); // round(5000*10/110)=455
  });

  test('facility null → 施設名フォールバック・住所/電話行なし', () => {
    const html = buildReceiptHtml({ ...base, facility: null });
    expect(html).toContain('施設名');
    expect(html).not.toContain('〒');
    expect(html).not.toContain('TEL:');
  });

  test('facility あり・postal/phone 無し → 住所/電話行は出さない', () => {
    const html = buildReceiptHtml({ ...base, facility: { name: 'Salon X' } });
    expect(html).toContain('Salon X');
    expect(html).not.toContain('〒');
    expect(html).not.toContain('TEL:');
  });

  test('postal_code ありで prefecture/city/address が null でも住所行を出す（?? フォールバック）', () => {
    const html = buildReceiptHtml({ ...base, facility: { name: 'S', postal_code: '100-0001', prefecture: null, city: null, address: null } });
    expect(html).toContain('〒100-0001');
  });

  test('XSS: 施設名やラベルがエスケープされる', () => {
    const html = buildReceiptHtml({ ...base, itemLabel: '<script>', facility: { name: '<b>x</b>' } });
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<script>');
  });
});

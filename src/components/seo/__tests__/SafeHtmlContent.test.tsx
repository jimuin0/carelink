/**
 * @jest-environment jsdom
 *
 * SafeHtmlContent の href サニタイズ検証。
 * 【2026年7月29日】decodeHtmlEntities が &amp;/&lt;/&gt;/&quot; と数値文字参照しか
 * デコードせず、&colon; 等の名前付き文字参照（HTML5に2,000件超定義）を経由すると
 * javascript: 等の危険プロトコルチェックをすり抜けられた脆弱性の回帰防止。
 */
import { render } from '@testing-library/react';
import SafeHtmlContent from '../SafeHtmlContent';

function renderHtml(html: string) {
  const { container } = render(<SafeHtmlContent html={html} />);
  return container.innerHTML;
}

describe('SafeHtmlContent: href サニタイズ', () => {
  test('javascript: を直接指定 → href 属性ごと除去', () => {
    const out = renderHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<a rel="noopener noreferrer">');
  });

  test('&colon; による javascript: の難読化（未知の名前付き文字参照） → href 属性ごと除去', () => {
    const out = renderHtml('<a href="javascript&colon;alert(1)">click</a>');
    expect(out).not.toMatch(/href="javascript/);
    expect(out).toContain('<a rel="noopener noreferrer">');
  });

  test('&Tab; 等の制御系名前付き参照で javascript: を分断 → href 属性ごと除去', () => {
    const out = renderHtml('<a href="java&Tab;script:alert(1)">click</a>');
    expect(out).not.toMatch(/href=/);
  });

  test('data: URI の難読化 → href 属性ごと除去', () => {
    const out = renderHtml('<a href="data&colon;text/html,<script>alert(1)</script>">click</a>');
    expect(out).not.toMatch(/href="data/);
  });

  test('数値文字参照(16進)で javascript: を構成 → href 属性ごと除去', () => {
    // javascript: を全て16進数値文字参照でエンコード（既存の数値デコード自体は正しく通す設計のため、
    // プロトコルチェックの方で拒否されることを確認する）
    const encoded = 'javascript:alert(1)'.split('').map((c) => `&#x${c.charCodeAt(0).toString(16)};`).join('');
    const out = renderHtml(`<a href="${encoded}">click</a>`);
    expect(out).not.toMatch(/href="javascript/);
  });

  test('通常の https URL → href 属性を保持', () => {
    const out = renderHtml('<a href="https://example.com/page">click</a>');
    expect(out).toContain('href="https://example.com/page"');
  });

  test('クエリ文字列を &amp; で区切った URL → href 属性を保持（正当ケースの回帰防止）', () => {
    const out = renderHtml('<a href="https://example.com/page?a=1&amp;b=2">click</a>');
    // innerHTML へのシリアライズ時、属性値中の '&' は '&amp;' に再エスケープされるのが
    // ブラウザ/jsdom の正しい挙動（実際の href プロパティ値としては '&' 1文字）。
    expect(out).toContain('href="https://example.com/page?a=1&amp;b=2"');
  });

  test('mailto: → href 属性を保持', () => {
    const out = renderHtml('<a href="mailto:test@example.com">click</a>');
    expect(out).toContain('href="mailto:test@example.com"');
  });

  test('サイト内相対パス → href 属性を保持', () => {
    const out = renderHtml('<a href="/facility/abc">click</a>');
    expect(out).toContain('href="/facility/abc"');
  });
});

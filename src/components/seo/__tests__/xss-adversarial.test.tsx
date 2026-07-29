/**
 * @jest-environment jsdom
 *
 * SafeHtmlContent の敵対検証（2026年7月29日）。
 *
 * 【なぜ必要か】XSS サニタイザは「よくある1〜2パターンを塞いだ」状態で安心しやすいが、
 * 攻撃側は大文字化・空白分断・各種エンコードを機械的に総当たりする。
 * 実際に本ファイルの作成過程で、名前付き文字参照（&colon; 等）による回避が
 * 成立することを実測しており、単発の確認では取りこぼす。
 * 典型的な回避手法を一覧で固定し、サニタイザに手を入れるたび全件で再確認する。
 */
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import SafeHtmlContent from '@/components/seo/SafeHtmlContent';

function renderHtml(html: string): string {
  const { container } = render(<SafeHtmlContent html={html} />);
  return container.innerHTML;
}

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const NUL = String.fromCharCode(0);

const ATTACKS: Array<[string, string]> = [
  ['大文字混在', '<a href="JaVaScRiPt:alert(1)">x</a>'],
  ['前置空白', '<a href="  javascript:alert(1)">x</a>'],
  ['タブで分断', `<a href="java${TAB}script:alert(1)">x</a>`],
  ['改行で分断', `<a href="java${LF}script:alert(1)">x</a>`],
  ['NULバイトで分断', `<a href="java${NUL}script:alert(1)">x</a>`],
  ['10進数値文字参照', '<a href="&#106;avascript:alert(1)">x</a>'],
  ['16進数値文字参照', '<a href="&#x6a;avascript:alert(1)">x</a>'],
  ['二重エンコード', '<a href="&#x26;#x6a;avascript:alert(1)">x</a>'],
  ['名前付き参照 colon', '<a href="javascript&colon;alert(1)">x</a>'],
  ['名前付き参照 Tab', `<a href="java&Tab;script:alert(1)">x</a>`],
  ['data URI', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
  ['vbscript スキーム', '<a href="vbscript:msgbox(1)">x</a>'],
  ['シングルクォート属性', "<a href='javascript:alert(1)'>x</a>"],
  ['img onerror', '<img src=x onerror="alert(1)">'],
  ['a タグの onclick', '<a href="/ok" onclick="alert(1)">x</a>'],
  ['script 直書き', '<script>alert(1)</script>'],
  ['iframe', '<iframe src="javascript:alert(1)"></iframe>'],
  ['svg onload', '<svg onload="alert(1)"></svg>'],
  ['プロトコル相対URL', '<a href="//evil.example/phish">x</a>'],
];

describe('SafeHtmlContent 敵対検証（XSS回避手法の総当たり）', () => {
  test.each(ATTACKS)('%s は無害化される', (_name, payload) => {
    const out = renderHtml(payload);
    expect(out).not.toMatch(/href="[^"]*javascript/i);
    expect(out).not.toMatch(/href="[^"]*vbscript/i);
    expect(out).not.toMatch(/href="[^"]*data:/i);
    // イベントハンドラ属性が一切残らないこと
    expect(out).not.toMatch(/\son[a-z]+\s*=/i);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<svg');
  });

  test('正当な https リンクは壊れない（過剰防御の回帰防止）', () => {
    const out = renderHtml('<a href="https://example.com/a?b=1&amp;c=2">x</a>');
    expect(out).toContain('href="https://example.com/a?b=1&amp;c=2"');
  });

  test('正当なサイト内相対リンクは壊れない', () => {
    const out = renderHtml('<a href="/facility/abc">x</a>');
    expect(out).toContain('href="/facility/abc"');
  });
});

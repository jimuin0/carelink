import { renderMarkdown } from '../facility-blog-markdown';

describe('renderMarkdown（施設ブログ）', () => {
  // 監査 A188: 本文のエスケープ後に属性用エスケープを重ねていたため、& が &amp;amp; になりクエリが壊れた。
  test('クエリ文字列を含むリンクの & を二重にエスケープしない', () => {
    const html = renderMarkdown('[予約](https://example.com/a?b=1&c=2)');
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(html).not.toContain('&amp;amp;');
  });

  test('URL 中の引用符は属性から抜け出せない', () => {
    const html = renderMarkdown('[x](https://example.com/"onmouseover="alert(1))');
    expect(html).not.toMatch(/href="[^"]*"onmouseover/);
    expect(html).toContain('&quot;onmouseover=&quot;');
  });

  test('http(s) と / 以外のスキームは # に倒す', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).toContain('href="#"');
    expect(renderMarkdown('[x](/facility/a)')).toContain('href="/facility/a"');
  });

  test('本文の HTML はエスケープされ、見出し・強調・リストは変換される', () => {
    const html = renderMarkdown("## 見出し\n### 小見出し\n**太字** *斜体* <script>\n- a\n- b\n\n次の段落'");
    expect(html).toContain('<h2>見出し</h2>');
    expect(html).toContain('<h3>小見出し</h3>');
    expect(html).toContain('<strong>太字</strong>');
    expect(html).toContain('<em>斜体</em>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>');
    expect(html).toContain('</p><p>');
  });

  test("URL 中の ' は属性用にエスケープする", () => {
    expect(renderMarkdown("[x](https://example.com/it's)")).toContain('href="https://example.com/it&#39;s"');
  });
});

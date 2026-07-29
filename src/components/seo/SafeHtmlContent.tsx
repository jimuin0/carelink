const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'h3', 'h4', 'a']);

const SAFE_URL_PATTERN = /^(?:https?:\/\/|mailto:|tel:|\/[^/])/i;

function decodeHtmlEntities(str: string): string {
  // Run multiple passes to handle double-encoded payloads (e.g. &#x26;#x6a; → &#x6a; → j)
  let prev = '';
  let cur = str;
  for (let i = 0; i < 5 && cur !== prev; i++) {
    prev = cur;
    cur = cur
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
  }
  return cur;
}

function isHrefSafe(raw: string): boolean {
  const decoded = decodeHtmlEntities(raw).replace(/[\s\x00-\x1f]+/g, '').toLowerCase();
  // 【2026年7月29日・恒久根治】decodeHtmlEntities は &amp;/&lt;/&gt;/&quot; と数値文字参照
  // (&#x..;/&#..;) しかデコードしない。HTML5 には &colon; (=':') 等 2,000 件超の名前付き
  // 文字参照が定義されており、ここで未対応のものは decoded 文字列上は無害な文字列に見えたまま
  // ブラウザ側だけがデコードして実際の href を組み立てる（例: "javascript&colon;alert(1)" は
  // このチェックを通過するが、ブラウザは href="javascript:alert(1)" として実行する）。
  // 個々のエンティティを網羅的に追加登録するのではなく、上記4種＋数値参照でデコードし切れず
  // "&名前;" 形式が残っている時点で「デコードできない未知の文字参照」として一律拒否する
  // ホワイトリスト方式に倒す（新しい名前付き参照が追加/発見されても構造的に安全側に倒れる）。
  if (/&#?[a-z0-9]+;/i.test(decoded)) return false;
  if (decoded.startsWith('javascript:') || decoded.startsWith('data:') || decoded.startsWith('vbscript:')) return false;
  return SAFE_URL_PATTERN.test(decoded) || !decoded.includes(':');
}

function sanitizeHtml(raw: string): string {
  // Strip all script/style/iframe/object/embed tags and their content
  let html = raw.replace(/<(script|style|iframe|object|embed|form|textarea|input|select|button)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Strip event handler attributes globally
  html = html.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');

  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tag) => {
    const lower = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return '';
    if (lower === 'br') return '<br />';
    if (match.startsWith('</')) return `</${lower}>`;
    if (lower === 'a') {
      const hrefMatch = match.match(/href\s*=\s*"([^"]*)"/i) || match.match(/href\s*=\s*'([^']*)'/i);
      if (hrefMatch && isHrefSafe(hrefMatch[1])) {
        const href = hrefMatch[1].replace(/"/g, '&quot;');
        return `<a href="${href}" rel="noopener noreferrer">`;
      }
      return '<a rel="noopener noreferrer">';
    }
    return `<${lower}>`;
  });
}

interface Props {
  html: string;
  className?: string;
}

export default function SafeHtmlContent({ html, className }: Props) {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}

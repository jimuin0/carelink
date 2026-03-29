const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'h3', 'h4', 'a']);

const SAFE_URL_PATTERN = /^(?:https?:\/\/|mailto:|tel:|\/[^/])/i;

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function isHrefSafe(raw: string): boolean {
  const decoded = decodeHtmlEntities(raw).replace(/[\s\x00-\x1f]+/g, '').toLowerCase();
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

const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'h3', 'h4', 'a']);

function sanitizeHtml(raw: string): string {
  // Remove all tags except allowed ones; strip all attributes except href on <a>
  return raw.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tag) => {
    const lower = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return '';
    // Self-closing tags
    if (lower === 'br') return '<br />';
    // For closing tags, keep as-is
    if (match.startsWith('</')) return `</${lower}>`;
    // For <a> tags, preserve href only
    if (lower === 'a') {
      const hrefMatch = match.match(/href="([^"]*)"/);
      if (hrefMatch) {
        const href = hrefMatch[1].replace(/javascript:/gi, '').replace(/on\w+=/gi, '');
        return `<a href="${href}" rel="noopener noreferrer">`;
      }
      return '<a>';
    }
    // All other allowed tags: strip all attributes
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

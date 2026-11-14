/**
 * 施設ブログ本文の簡易 Markdown → HTML 変換（/facility/[slug]/blog/[postSlug]）。
 * 本文を先に HTML エスケープしてから記法を当てるので、生の HTML は通らない。
 */
function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
  return '#';
}

// 手順1で本文全体を HTML エスケープしているため、リンクの URL も既に &amp; 等になっている。
// そのまま escapeAttr すると '&' が二重に '&amp;amp;' となり、遷移先のクエリが壊れる（監査 A188）。
// 属性へ入れる直前に一度だけ元へ戻し、改めて属性用にエスケープする。
function unescapeHtml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderMarkdown(text: string): string {
  // 1. HTML特殊文字を先にエスケープ（XSS防止の基盤）
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // 2. マークダウン変換（エスケープ済みテキストに対して安全に適用）
  html = html
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\[(.+?)\]\((.+?)\)/g, (_, label, url) => `<a href="${escapeAttr(sanitizeUrl(unescapeHtml(url)))}" class="text-sky-700 underline" rel="noopener noreferrer">${label}</a>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // 3. 連続した<li>をまとめて<ul>でラップ
  html = html.replace(/(<li>.*?<\/li>(?:<br>)?)+/g, (match) => {
    return '<ul>' + match.replace(/<br>/g, '') + '</ul>';
  });

  return '<p>' + html + '</p>';
}

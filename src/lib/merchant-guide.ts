/**
 * Reviewed merchant-guide slugs only. Audience classification is explicit so customer
 * articles cannot accidentally inherit a merchant CTA or inline renderer.
 */
export const MERCHANT_GUIDE_SLUG = 'salon-free-listing-checklist';
export const MERCHANT_DIAGNOSTIC_SLUG = 'salon-booking-funnel-checklist';
const MERCHANT_GUIDE_SLUGS: ReadonlySet<string> = new Set([
  MERCHANT_GUIDE_SLUG,
  MERCHANT_DIAGNOSTIC_SLUG,
]);

const GUIDE_LINKS: ReadonlySet<string> = new Set([
  '/register',
  '/terms',
  '/legal',
  'https://salonboard.com/faq/',
]);

export type MerchantInlineToken =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'link'; text: string; href: string };

export function isMerchantGuide(slug: string): boolean {
  return MERCHANT_GUIDE_SLUGS.has(slug);
}

/** Render only reviewed emphasis and exact allow-listed links; never execute HTML. */
export function tokenizeMerchantInline(text: string): MerchantInlineToken[] {
  const tokens: MerchantInlineToken[] = [];
  const pattern = /\*\*([^*\n]{1,2000})\*\*|\[([^\]\n]{1,500})\]\(([^()\s]{1,2048})\)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > cursor) tokens.push({ type: 'text', text: text.slice(cursor, start) });
    if (match[1] !== undefined) {
      tokens.push({ type: 'strong', text: match[1] });
    } else if (GUIDE_LINKS.has(match[3])) {
      tokens.push({ type: 'link', text: match[2], href: match[3] });
    } else {
      tokens.push({ type: 'text', text: match[0] });
    }
    cursor = start + match[0].length;
  }
  if (cursor < text.length) tokens.push({ type: 'text', text: text.slice(cursor) });
  return tokens;
}

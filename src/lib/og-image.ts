import sharp from 'sharp';

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_TITLE_LENGTH = 40;
const MAX_SUBTITLE_LENGTH = 60;
const CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400, immutable';

function normalizeDisplayText(value: string | null, fallback: string, maxLength: number): string {
  const characters = Array.from(value ?? '').filter((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
  });
  const normalized = characters.join('').normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!normalized) return fallback;
  return Array.from(normalized).slice(0, maxLength).join('');
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[character];
  });
}

function wrapTitle(value: string, lineLength: number): string[] {
  const characters = Array.from(value);
  const lines: string[] = [];
  for (let index = 0; index < characters.length; index += lineLength) {
    lines.push(characters.slice(index, index + lineLength).join(''));
  }
  return lines;
}

function ratingMarkup(rating: number | null, reviewCount: number | null, y: number): string {
  if (rating === null) return '';

  const fullStars = Math.floor(rating);
  const hasHalfStar = rating - fullStars >= 0.5;
  const stars = Array.from({ length: 5 }, (_, index) => {
    const isFull = index < fullStars;
    const isHalf = index === fullStars && hasHalfStar;
    const color = isFull || isHalf ? '#f59e0b' : '#d1d5db';
    return `<text x="${300 + index * 40}" y="${y}" font-size="34" fill="${color}">★</text>`;
  }).join('');
  const reviewMarkup = reviewCount === null
    ? ''
    : `<text x="520" y="${y - 4}" font-size="22" fill="#64748b">(${reviewCount}件)</text>`;

  return `<g aria-label="評価 ${rating.toFixed(1)}">
    <text x="72" y="${y}" font-size="48" font-weight="700" fill="#f59e0b">${rating.toFixed(1)}</text>
    ${stars}${reviewMarkup}
  </g>`;
}

export function buildOgImageSvg(searchParams: URLSearchParams): string {
  const title = normalizeDisplayText(searchParams.get('title'), 'CareLink', MAX_TITLE_LENGTH);
  const subtitle = normalizeDisplayText(
    searchParams.get('subtitle'),
    'ネットでかんたんサロン予約',
    MAX_SUBTITLE_LENGTH,
  );
  const ratingValue = searchParams.get('rating');
  const parsedRating = ratingValue ? Number.parseFloat(ratingValue) : Number.NaN;
  const rating = Number.isFinite(parsedRating)
    ? Math.min(5, Math.max(0, parsedRating))
    : null;
  const reviewValue = searchParams.get('reviews');
  const reviewCount = reviewValue && /^\d{1,9}$/.test(reviewValue)
    ? Number.parseInt(reviewValue, 10)
    : null;
  const titleLines = wrapTitle(title, 20);
  const titleFontSize = Array.from(title).length > 20 ? 56 : 68;
  const firstTitleY = titleLines.length > 1 ? 268 : 300;
  const titleMarkup = titleLines.map((line, index) => (
    `<text x="72" y="${firstTitleY + index * 64}" font-size="${titleFontSize}" font-weight="700" fill="#0f172a">${escapeXml(line)}</text>`
  )).join('');
  const subtitleY = firstTitleY + (titleLines.length - 1) * 64 + 70;
  const isFacility = Boolean(ratingValue);
  const facilityBadge = isFacility
    ? '<rect x="286" y="60" width="132" height="42" rx="21" fill="#e0f2fe"/><text x="352" y="88" text-anchor="middle" font-size="20" fill="#0284c7">施設情報</text>'
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0284c7"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient>
      <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0284c7"/><stop offset="1" stop-color="#38bdf8"/></linearGradient>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#f0f9ff"/>
    <rect width="12" height="${HEIGHT}" fill="url(#bar)"/>
    <circle cx="1190" cy="0" r="230" fill="#0ea5e9" fill-opacity="0.08"/>
    <circle cx="1140" cy="610" r="160" fill="#0ea5e9" fill-opacity="0.06"/>
    <g font-family="Arial, sans-serif">
      <rect x="72" y="60" width="190" height="42" rx="21" fill="url(#brand)"/>
      <text x="167" y="89" text-anchor="middle" font-size="24" font-weight="700" fill="#fff">CareLink</text>
      ${facilityBadge}
      ${titleMarkup}
      <text x="72" y="${subtitleY}" font-size="28" fill="#475569">${escapeXml(subtitle)}</text>
      ${ratingMarkup(rating, reviewCount, subtitleY + 88)}
      <text x="72" y="574" font-size="18" fill="#94a3b8">carelink-jp.com</text>
    </g>
  </svg>`;
}

export async function renderOgImagePng(searchParams: URLSearchParams): Promise<Buffer> {
  const svg = buildOgImageSvg(searchParams);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export const OG_IMAGE_HEADERS = {
  'Cache-Control': CACHE_CONTROL,
  'Content-Type': 'image/png',
};

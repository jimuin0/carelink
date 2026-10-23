/**
 * 掲載申込フォーム（/register）の入力ゆれを、検証の前に吸収する純粋関数。
 *
 * - 郵便番号: 全角数字「５６０－０００１」や「〒」付きの貼り付けが検証で弾かれ、
 *   住所の自動補完（7桁の半角数字を見ている）も動かなかった。
 * - Webサイト: 「example.com」のようにスキームを省くと「正しいURLを入力してください」で
 *   止まっていた。スキームが無いときだけ https:// を補う（既にあるものは書き換えない）。
 *
 * 推測で値を作らない（市外局番の表や存在しないドメインの補完はしない）。
 */

/** 各種ダッシュ・長音記号。NFKC でも半角ハイフンにならないものをまとめて寄せる。 */
const DASHES = /[‐-‒–—―ーｰ−]/g;

export function normalizePostalCodeInput(value: string): string {
  return value
    .normalize('NFKC')
    .replace(DASHES, '-')
    .replace(/^〒/, '')
    .replace(/\s+/g, '');
}

/** `scheme://` か、`mailto:` のような「: の直後が数字でない」スキームを持つか。 */
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:(\/\/|(?!\d))/i;

export function normalizeWebsiteInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (HAS_SCHEME.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

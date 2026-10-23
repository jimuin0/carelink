import { UUID_REGEX } from './constants';

/**
 * 掲載申込の受付番号（DB の UUID・36 文字）を画面で読み上げ・書き写しやすくした短い参照。
 * UUID の先頭 8 桁を大文字にして 4 桁ずつ区切る（例: 3f2a9c1e-… → 3F2A-9C1E）。
 * 同じ受付からは常に同じ表示になる（決定的・DB 変更なし）。
 *
 * 短い参照は一意とは限らないため、照会に使うのは完全な受付番号（UUID）。画面では両方を出す。
 * UUID でない値はそのまま返す（推測した表示を作らない）。
 */
export function receiptShortReference(id: string): string {
  if (!UUID_REGEX.test(id)) return id;
  const head = id.slice(0, 8).toUpperCase();
  return `${head.slice(0, 4)}-${head.slice(4)}`;
}

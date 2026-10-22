/**
 * 施設ページ「アクセス」タブの地図埋め込み（AccessInfo.tsx）の単一ソース。
 *
 * middleware.ts の CSP `frame-src` はこの ORIGIN だけを地図用に許可する。iframe の URL と
 * CSP の許可先を別々に書くと片方だけ変わって地図が無言で消えるため、両方ここから読む。
 *
 * 2026年10月22日まで iframe は https://maps.google.com/maps?…&output=embed を指していたが、
 * frame-src に Google が無く、本番では地図が常に CSP で拒否されて空白だった。
 * maps.google.com は www.google.com/maps/embed へ 301 するので、CSP（リダイレクトの各段で
 * 検査される）に 2 ホストを許可する必要があった。最初から www.google.com を指して
 * 許可先を 1 つに絞っている（同じホスト内で /maps/embed へ 301 する）。
 */
export const GOOGLE_MAPS_EMBED_ORIGIN = 'https://www.google.com';

/** `query` は「緯度,経度」またはエンコード済みの住所。 */
export function googleMapsEmbedUrl(query: string): string {
  return `${GOOGLE_MAPS_EMBED_ORIGIN}/maps?q=${query}&z=16&output=embed`;
}

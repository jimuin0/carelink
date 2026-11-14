/**
 * Supabase Storage 公開バケットの自プレフィックスのみを許可する（任意URL混入の拒否）。
 *
 * 【2026年7月8日 恒久根治】施設オーナー登録(api/salons)は自Storage公開URLプレフィックス限定
 * チェックを実装していたが、口コミ投稿(api/review)は `.url().startsWith('https://')` のみで
 * 任意のHTTPS URLを許容していた。next.config の remotePatterns（自Supabase Storage と
 * images.unsplash.com のみ許可）に守られてはいるが、許可済みホスト向けのURLなら任意画像の
 * ホットリンク表示が可能で、同水準の出所検証が欠けていた。共通化して両者で使う。
 */
export function isAllowedStorageUrl(url: string, bucket: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  const prefix = `/storage/v1/object/public/${bucket}/`;
  if (!url.startsWith(`${base}${prefix}`)) return false;
  // 文字列の前方一致だけだと `…/public/salons/../review-photos/x.jpg` も通り、ブラウザ・next/image が
  // ドットセグメントを解決した結果、別バケットを指せた（低 A222）。URL として正規化した後の
  // オリジンとパスでも確かめる（WHATWG URL は %2e も含めてドットセグメントを解決する）。
  let parsed: URL;
  let baseUrl: URL;
  try {
    parsed = new URL(url);
    baseUrl = new URL(base);
  } catch {
    return false;
  }
  return parsed.origin === baseUrl.origin && parsed.pathname.startsWith(`${baseUrl.pathname.replace(/\/$/, '')}${prefix}`);
}

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
  return url.startsWith(`${base}/storage/v1/object/public/${bucket}/`);
}

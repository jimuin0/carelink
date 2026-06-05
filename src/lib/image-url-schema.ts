import { z } from 'zod';

/**
 * 画像URLの共有 zod スキーマ（round3 #16 の防御を全 image_url 入力で共有・round6 横展開）。
 * https もしくは data:image(png/jpeg/gif/webp) のみ許可し、javascript:/data:text/html/data:image/svg+xml 等の
 * 危険スキームを書込時に弾く。公開ページの <img src> 直挿しに対する多層防御。
 * blog(thumbnail/image_urls) と coupons(image_url) で同一スキーマを参照する。
 */
export const IMAGE_URL = z.string().max(200000).refine(
  (s) => /^https:\/\//i.test(s) || /^data:image\/(png|jpe?g|gif|webp);/i.test(s),
  '画像URLは https または data:image のみ許可されます',
);

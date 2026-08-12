/**
 * ストック写真サービスの画像URLが【新たに】保存されるのを拒否する（2026年8月11日 新設）。
 *
 * 【なぜ必要か】初期シード（`supabase/migrations/20260321000004_facilities_phase1.sql` /
 * `20260331000001_data_enrichment.sql` / `scripts/seed-facilities.mjs`）が実店舗の写真の
 * 代わりに Unsplash の URL を投入したため、本番に「実在の施設の写真ではない画像」が残り
 * 続けている。実在施設を紹介する媒体として不適切なだけでなく、表示のために
 * `next.config.mjs` の `remotePatterns` へ `images.unsplash.com` を許可し続けるしかなく、
 * 【任意のホットリンク画像を表示できる外部ホストを1つ常設する】状態を招いている。
 * 既存分の差し替えは本番データの作業だが、【新たに増やさない】のはコードの仕事。
 *
 * 【なぜ「新規のみ」拒否なのか＝導入順序の依存を設計で消すため】
 * 既存の値をそのまま送り直す更新（タイトルだけ直す等。管理画面はフォーム全体を PATCH で
 * 送るため必ずこの形になる）まで拒否すると、ストック画像が残っている記事・メニューを
 * 一切編集できなくなる。つまり「本番データの掃除 → ガード投入」の順序でしか入れられず、
 * 逆順で入れると管理画面が壊れる。素通し条件を持たせることで【掃除より先に入れても安全】
 * にしてある。掃除が終わったあとも挙動は変わらない（掃除後は素通しする値が存在しない）。
 *
 * 【対象外】`facility_photos` / `salons` / `review` の写真は既に
 * `isAllowedStorageUrl()`（`src/lib/storage-url-guard.ts`）で自 Supabase Storage の公開
 * プレフィックス限定になっており、そもそも外部ホストを保存できない。ここで守るのは
 * 「任意の https URL を受け付ける」入口＝`feature_articles.image_url` と
 * `facility_menus.photo_url` の2つだけ。新しい入口を足す場合は
 * `src/__tests__/stock-image-guard-wiring.test.ts` が配線漏れを検出する。
 *
 * 【意図的に対象外＝本文の自由記述】`blog_posts.content` 等の本文に埋め込まれた <img> は
 * 走査していない。本文には「画像は Unsplash から引用」のようにサービス名やリンクを
 * 正当に書ける以上、URL の出現だけを根拠に保存を拒否すると誤爆する。ここは表示側の
 * 話（`next.config.mjs` の remotePatterns）で塞ぐべき問題で、入口ガードの担当ではない。
 */

/**
 * 既知のストック写真サービス。登録ドメインそのもの、またはそのサブドメインを弾く
 * （`images.unsplash.com` / `plus.unsplash.com` のように配信ホストが複数あるため、
 * ホスト名の完全一致リストにすると必ず取りこぼす）。
 */
export const STOCK_IMAGE_DOMAINS = [
  'unsplash.com',
  'pexels.com',
  'pixabay.com',
  'istockphoto.com',
  'shutterstock.com',
  'gettyimages.com',
  'freepik.com',
  'photo-ac.com',
  'stock.adobe.com',
] as const;

/** 管理画面に返す拒否理由（4つの入口で同一文言を使う）。 */
export const STOCK_IMAGE_ERROR =
  'ストック写真サービスの画像URLは登録できません。施設で撮影した写真をアップロードしてください';

/** URL がストック写真サービスのものか。 */
export function isStockImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    // URL として解釈できない値は各ルートの zod `.url()` が別途 400 で弾く。
    // ここで true を返すと「不正URL」を「ストック画像」と誤って説明することになるため false。
    return false;
  }
  return STOCK_IMAGE_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

/**
 * 保存を拒否すべきか＝【新たに】ストック画像を入れようとしているか。
 * 既存値と同一（＝画像を変えていない更新）なら false を返して素通しする。
 * 新規作成では `previous` を省略する（＝既存値が無いので必ず拒否対象になる）。
 */
export function isNewStockImage(
  next: string | null | undefined,
  previous?: string | null
): boolean {
  if (!isStockImageUrl(next)) return false;
  return next !== previous;
}

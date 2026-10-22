import { cache } from 'react';
import { searchFacilities } from './facilities';

/**
 * エリア・業種の一覧ページ（/[都道府県]・/[都道府県]/[業種|市区町村]・/[都道府県]/[市区町村]/[業種]・
 * /type/[業種]）の検索結果を、metadata（掲載 0 件の noindex 判定）と本文で共有する（2026年10月22日）。
 *
 * 【なぜ共有するか】Next 16 の metadata は本文とは別に（Suspense の中で）描画される。metadata だけが
 * 別の問い合わせで件数を数えていると、その問い合わせだけが一時障害（接続プール枯渇・statement timeout）
 * で落ちたとき、本文は 200 で返り、title・canonical・robots が 1 つも出ない（ブラウザ・Googlebot とも）。
 * 読み取りを 1 つにまとめ、本文からも同じ読み取りを待てば、失敗は本文からも例外になり error.tsx（5xx）になる。
 * 同じリクエスト内では cache で 1 回にまとまる（引数は cache の照合が効くようプリミティブだけにする）。
 *
 * 読み取りに失敗したら例外にする（「0件・掲載なし」を 200 で返さない／障害中に noindex を付けない）。
 */
const loadAreaListing = cache(async (
  prefecture: string | undefined,
  city: string | undefined,
  type: string | undefined,
  page: number,
) => {
  const result = await searchFacilities({ prefecture, city, type, sort: 'rating', page });
  if (result.error) throw new Error('AREA_RESULTS_UNAVAILABLE');
  return result;
});

/**
 * metadata 用。掲載件数（1 ページ目の検索の total）。noindex の判定は常に 1 ページ目で行う
 * （結果より後ろのページは本文が 1 ページ目へ戻すため、そのページの件数では判定しない）。
 */
export async function countAreaListing(
  prefecture: string | undefined,
  city: string | undefined,
  type: string | undefined,
): Promise<number> {
  return (await loadAreaListing(prefecture, city, type, 1)).total;
}

/**
 * 本文用。表示するページの検索結果を返す。metadata が件数の判定に使う 1 ページ目も同じリクエストで待ち、
 * metadata の読み取りだけが失敗して「200・metadata 欠落」になる経路を残さない（1 ページ目なら同じ読み取り）。
 */
export async function loadAreaListingPage(
  prefecture: string | undefined,
  city: string | undefined,
  type: string | undefined,
  page: number,
) {
  const [current] = await Promise.all([
    loadAreaListing(prefecture, city, type, page),
    loadAreaListing(prefecture, city, type, 1),
  ]);
  return current;
}

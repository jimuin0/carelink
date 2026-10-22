/**
 * こだわり条件（facility_profiles.features の値）で絞り込む検索 URL を組み立てる。
 *
 * 【2026年10月22日 是正】トップ・エリア×業種ページ・施設ページの「こだわり条件」チップは
 * `/search?keyword=駐車場あり` を出していた。キーワード検索は施設名・紹介文・住所・アクセス等の
 * 文字列一致なので、`features` に「駐車場あり」を持つ施設でも紹介文に同じ語が無ければ当たらず、
 * 逆に紹介文で「駐車場はありません」と書いた施設が当たる。絞り込みパネルと同じ `features=`
 * （features 配列の完全一致）を使う。業種・エリアのページから来た場合はその条件を引き継ぐ。
 */
export function featureSearchHref(feature: string, scope: { type?: string; area?: string } = {}): string {
  const params = new URLSearchParams();
  if (scope.type) params.set('type', scope.type);
  if (scope.area) params.set('area', scope.area);
  params.set('features', feature);
  return `/search?${params.toString()}`;
}

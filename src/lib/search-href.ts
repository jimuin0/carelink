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

/**
 * 特集ページの「サロンを探す」「すべての施設を見る」の検索リンク。
 * 特集本文の一覧（filter_type / filter_keyword / filter_prefecture）と同じ条件で検索させる。
 * 以前は都道府県を落としており全国の結果が出ていた。type が無いと `/search?&keyword=` にもなっていた。
 */
export function featureArticleSearchHref(filters: {
  filter_type?: string | null;
  filter_keyword?: string | null;
  filter_prefecture?: string | null;
}): string {
  const params = new URLSearchParams();
  if (filters.filter_type) params.set('type', filters.filter_type);
  if (filters.filter_prefecture) params.set('area', filters.filter_prefecture);
  if (filters.filter_keyword) params.set('keyword', filters.filter_keyword);
  const query = params.toString();
  return query ? `/search?${query}` : '/search';
}

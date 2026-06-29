// 来院者（一般ユーザー）の施設お気に入りトグル E2E の共有定数。
// visitor-favorite.setup.ts が CI の隔離 Supabase（supabase start）に公開施設＋来院者を
// service role で seed しログインして storageState を保存。visitor-favorite.spec.ts が
// その認証状態で /facility/{slug} のお気に入りボタンをトグル検証する。本番には一切触れない。

export const VISITOR_FAVORITE_AUTH_FILE = 'e2e/.auth/visitor-favorite.json';
// setup が seed した施設 slug を書き出すファイル（spec が読んで /facility/{slug} を開く）。
export const VISITOR_FAVORITE_FACILITY_FILE = 'e2e/.auth/visitor-favorite-facility.json';

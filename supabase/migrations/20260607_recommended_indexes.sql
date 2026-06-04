-- 推奨インデックス（#5・性能）。実クエリの並び替えパターンに合わせた複合索引を追加する。
-- 既存はいずれも (facility_id) 単独索引のみで、sort_order/created_at の ORDER BY は都度ソートになる。
-- 多施設・大量メニュー/写真/口コミの規模で sort コストを index で賄う。冪等（IF NOT EXISTS）・非破壊。
--
-- 注: 現状データ規模では index 構築のロック時間は軽微なため通常の CREATE INDEX で問題ない。
--     将来テーブルが大規模化した場合は CREATE INDEX CONCURRENTLY での再作成を検討する。

-- facility_menus: .eq('facility_id').order('sort_order').order('created_at')（ListingBoard/SalonBoard 等）
CREATE INDEX IF NOT EXISTS idx_facility_menus_facility_sort
  ON facility_menus(facility_id, sort_order, created_at);

-- facility_photos: 同上（.eq('facility_id').order('sort_order').order('created_at')）
CREATE INDEX IF NOT EXISTS idx_facility_photos_facility_sort
  ON facility_photos(facility_id, sort_order, created_at);

-- facility_reviews: 管理画面の口コミ一覧は status フィルタ無しで created_at DESC 並び（admin/reviews・
-- review-summary・ListingBoard）。既存 idx_reviews_facility_published は WHERE status='published' の
-- 部分索引＝公開表示専用のため、全ステータスを跨ぐ管理一覧には効かない。フル索引を追加する。
CREATE INDEX IF NOT EXISTS idx_facility_reviews_facility_created
  ON facility_reviews(facility_id, created_at DESC);

-- 口コミ Pick Up（HPB同等化 #37）: facility_reviews に注目口コミフラグを追加
-- サロンごとに1件を Pick Up として強調表示する（複数 true でもUI上は許容、運用上は1件）
ALTER TABLE facility_reviews
  ADD COLUMN IF NOT EXISTS is_pickup BOOLEAN NOT NULL DEFAULT false;

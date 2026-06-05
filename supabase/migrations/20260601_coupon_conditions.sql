-- クーポン掲載情報の詳細フィールド（HPB クーポン編集相当）
-- 提示条件 / 利用条件 / 検索用カテゴリ（2段）/ メニュー指定 所要目安時間
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS presentation_timing TEXT,   -- 予約時 / 来店時
  ADD COLUMN IF NOT EXISTS usage_condition     TEXT,   -- 利用条件（自由記述）
  ADD COLUMN IF NOT EXISTS search_category1    TEXT,   -- 検索用カテゴリ（大）
  ADD COLUMN IF NOT EXISTS search_category2    TEXT,   -- 検索用カテゴリ（小）
  ADD COLUMN IF NOT EXISTS duration_minutes    INT;    -- メニュー指定 所要目安時間（分）

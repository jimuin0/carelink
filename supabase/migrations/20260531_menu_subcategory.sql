-- メニューカテゴリの2階層化：HPB メニュー編集の「大分類／小分類」表示と「検索用カテゴリ」を実カラム化。
-- 既存運用へ無影響にするため NULL 許容＋ IF NOT EXISTS。
ALTER TABLE facility_menus
  ADD COLUMN IF NOT EXISTS subcategory     TEXT,  -- カテゴリ小分類（例: その他まつげメニュー）
  ADD COLUMN IF NOT EXISTS search_category TEXT;  -- 検索用カテゴリ（例: まつげ・メイクなど：まつげデザイン・ケア）

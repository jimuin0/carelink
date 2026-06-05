-- ブログ本文の複数画像（HPB同等化 #33）: blog_posts に最大4枚の画像URL配列を追加
-- 既存 thumbnail_url（1枚目サムネ）はそのまま、本文中に表示する追加画像を image_urls に保持する。
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}';

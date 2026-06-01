-- ブログ記事のカテゴリ（HPB ブログ編集「カテゴリ」相当）
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS category TEXT;

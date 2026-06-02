-- ブログ予約掲載（HPB同等化 #34）: blog_posts に公開予約時刻を追加
-- scheduled_at が未来の間は公開ページの読取りフィルタで非表示にし、時刻到来後に自動表示（cron不要）
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- 公開ブログ取得の絞り込み（is_published かつ 予約時刻未設定 or 到来済み）を高速化
CREATE INDEX IF NOT EXISTS idx_blog_posts_scheduled
  ON blog_posts (facility_id, scheduled_at)
  WHERE is_published = true;

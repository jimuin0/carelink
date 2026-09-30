-- CL-15: 外部投稿後のDB記録失敗をambiguousとして隔離し、二重投稿を自動再実行しない。
DO $guard$
BEGIN
  IF to_regclass('public.platform_blog_posts') IS NULL THEN
    RAISE EXCEPTION 'platform_blog_postsが見つかりません。接続先を確認してください。';
  END IF;
END
$guard$;

ALTER TABLE public.platform_blog_posts
  ADD COLUMN IF NOT EXISTS threads_post_status text,
  ADD COLUMN IF NOT EXISTS threads_last_error text;

ALTER TABLE public.platform_blog_posts
  DROP CONSTRAINT IF EXISTS platform_blog_posts_threads_post_status_check;
ALTER TABLE public.platform_blog_posts
  ADD CONSTRAINT platform_blog_posts_threads_post_status_check
  CHECK (threads_post_status IS NULL OR threads_post_status IN ('processing', 'published', 'permanent', 'ambiguous'));

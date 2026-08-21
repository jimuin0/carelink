-- Threads 投稿の基盤（クライアント＋スキーマ）
-- 記事公開を Threads(https://www.threads.net/) へ自動投稿するための土台。
-- 投稿ロジック本体は src/lib/threads.ts。このマイグレーションは以下2点のみ:
--   (a) アクセストークンを保管する threads_credentials（単一行運用）
--   (b) 二重投稿防止のための platform_blog_posts への投稿済みマーカー列

-- ============================================================================
-- 🔴 接続先ガード（誤ったプロジェクトへ適用したら何も作らずに落ちる）
-- ============================================================================
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION
      'このデータベースは CareLink ではありません（public.facility_profiles が存在しない）。'
      ' 接続先プロジェクトを確認してください。CareLink の本番 ref は xzafxiupbflvgbarrihe です。';
  END IF;
END
$guard$;

-- ============================================================================
-- (a) threads_credentials — Threads 長期アクセストークンの保管（単一行運用）
-- ============================================================================
-- 命名・型は google_calendar_tokens（supabase/migrations/20260417000016_google_calendar.sql）
-- の慣行を踏襲する（id=uuid PK・timestamptz・created_at/updated_at）。
--
-- Threads の長期トークンは 60日で失効し、24時間以上経過かつ未失効の間だけ
-- 更新できる（60日を過ぎると手動再認可が必要）。cron が定期的に
-- refreshThreadsToken() を呼んで expires_at / refreshed_at を更新する想定。
--
-- 🔴 RLS を有効化し、anon/authenticated 向けの許可ポリシーは 1 本も作らない。
--   アクセストークンは秘密そのものなので、既定で「読めない」状態にする。
--   service_role は RLS をバイパスするため cron / API からは通常どおり読める
--   （cron_alert_claims と同方針。supabase/migrations/20260717000004_cron_alert_claims.sql 参照）。
CREATE TABLE IF NOT EXISTS threads_credentials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  refreshed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE threads_credentials ENABLE ROW LEVEL SECURITY;
-- service_role のみアクセス可（cron・API 専用）。anon/authenticated ポリシーは意図的に作らない。

CREATE OR REPLACE FUNCTION update_threads_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_threads_credentials_updated_at ON threads_credentials;
CREATE TRIGGER trg_threads_credentials_updated_at
  BEFORE UPDATE ON threads_credentials
  FOR EACH ROW EXECUTE FUNCTION update_threads_credentials_updated_at();

-- ============================================================================
-- (b) platform_blog_posts — 投稿済みマーカー（二重投稿防止）
-- ============================================================================
-- 記事は PATCH で何度も保存され、公開トグルも往復するため、「公開された」を
-- 毎回投稿のきっかけにすると同じ記事が何度も Threads へ流れる。
-- threads_post_id が非 null なら「投稿済み」として扱う。
ALTER TABLE platform_blog_posts
  ADD COLUMN IF NOT EXISTS threads_post_id   TEXT,
  ADD COLUMN IF NOT EXISTS threads_posted_at TIMESTAMPTZ;

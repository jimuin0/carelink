-- =============================================================================
-- 本番実在テーブルの migration 追補（features / job_postings）
-- =============================================================================
-- features / job_postings は本番に実在し現行アプリが利用しているが、これまで
-- 対応する CREATE TABLE 定義が migration 側に存在せず（out-of-band 作成のドリフト）、
-- fresh-apply（新規環境 replay）で後続 migration が以下を参照して失敗していた:
--   - 20260330000001_phase_c_infra.sql:93  CREATE INDEX ... ON features(slug)
--   - 20260417000027_recruitment.sql        job_posting_id ... REFERENCES job_postings(id)
-- ADR-0005（本番スキーマ変更は必ず migration 経由）に従い、本ファイルで両テーブルを
-- 冪等に定義する。列は本番 introspection 済 src/types/database.types.ts に忠実。
-- 既に本テーブルが存在する本番には IF NOT EXISTS により無害（再適用安全）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- features: 特集記事（公開 LP 用）。anon が is_published=true のみ読む（src/lib/features.ts）。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS features (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL,
  title             text NOT NULL,
  description       text,
  content           jsonb,
  banner_image_url  text,
  display_order     integer,
  filter_keyword    text,
  filter_prefecture text,
  filter_type       text,
  is_published      boolean DEFAULT false,
  published_at      timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE features ENABLE ROW LEVEL SECURITY;

-- 公開済み特集のみ anon に読ませる（facility_menus の "Public read" パターン準拠）。
DROP POLICY IF EXISTS "Public read published features" ON features;
CREATE POLICY "Public read published features" ON features
  FOR SELECT TO anon
  USING (is_published = true);

-- -----------------------------------------------------------------------------
-- job_postings: 旧世代の求人テーブル。現行アプリからの読み書き参照は無い（FK 専用）。
--   20260417000027_recruitment.sql が job_posting_id で参照するため存在が必要。
--   RLS 有効・ポリシー無し＝anon/authenticated は不可視（service_role のみ）。安全側に倒す。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_postings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  facility_name   text NOT NULL,
  job_type        text NOT NULL,
  employment_type text NOT NULL,
  description     text NOT NULL,
  requirements    text,
  salary          text NOT NULL,
  location        text NOT NULL,
  working_hours   text,
  holidays        text,
  benefits        text,
  contact_email   text,
  contact_phone   text,
  status          text DEFAULT 'open',
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;

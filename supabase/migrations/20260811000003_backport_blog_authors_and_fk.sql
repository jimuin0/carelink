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
-- blog_authors テーブルと blog_posts → blog_authors FK を migration へ取り込む（2026-08-11）
-- ============================================================================
-- 【発見経緯】blog_authors はスキーマ・フィンガープリント監視の対象となる前から本番に
--   実在していたが、対応する定義 migration（CREATE TABLE 文）が一度も無かった（out-of-band
--   作成の残存）。20260629000002_prod_drift_columns_catchup.sql は blog_posts.author_name_id
--   列だけを追加し、参照先テーブルが fresh DB に存在しないため FK は意図的に省略していた
--   （同ファイルのコメント参照）。以来 blog_authors は
--   `src/lib/known-prod-only.json` の KNOWN_PROD_ONLY 台帳に載せて監視から除外していた。
--
-- 【本移行の目的】blog_authors 自体を migration へ back-port し、fresh-apply（shadow /
--   CI）が本番と一致するようにする。これにより:
--     (a) 上記コメントで「省略」としていた blog_posts → blog_authors FK も併せて追加でき、
--     (b) known-prod-only.json から blog_authors を削除でき、
--     (c) スキーマ・フィンガープリント監視の「本番専用テーブル7本」由来の除外対象が減り、
--         スキーマドリフト監視の最後の既知差分項目が解消する。
--
-- 【本番への影響 = no-op】このファイルが定義する全オブジェクト（テーブル・インデックス・
--   RLS・ポリシー・FK）は本番に既に存在する。IF NOT EXISTS / DROP POLICY IF EXISTS /
--   pg_constraint 存在チェック付き DO ブロックにより、本番への適用は実質何もしない。
--   fresh な shadow / CI DB にだけ新しくオブジェクトを作る。
--
-- 【定義は本番 introspection（information_schema / pg_constraint / pg_indexes /
--   pg_policies）の実測値をそのまま使用】列順・型・NOT NULL・DEFAULT・制約名・
--   インデックス名・ポリシー名・USING 句を本番と一字一句同じにする。
-- ============================================================================

-- --------------------------------------------------------------------------
-- blog_authors 本体
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blog_authors (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT blog_authors_pkey PRIMARY KEY (id),
  CONSTRAINT blog_authors_facility_id_fkey FOREIGN KEY (facility_id)
    REFERENCES public.facility_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blog_authors_facility ON public.blog_authors USING btree (facility_id);

ALTER TABLE public.blog_authors ENABLE ROW LEVEL SECURITY;

-- 施設メンバーのみ自施設の著者行を閲覧可能（本番実測どおり FOR SELECT のみ・WITH CHECK 無し）。
DROP POLICY IF EXISTS "blog_authors member select" ON public.blog_authors;
CREATE POLICY "blog_authors member select" ON public.blog_authors
  FOR SELECT TO authenticated
  USING (facility_id IN (SELECT facility_members.facility_id FROM facility_members WHERE facility_members.user_id = auth.uid()));

-- --------------------------------------------------------------------------
-- blog_posts.author_name_id → blog_authors(id) FK
--   20260629000002_prod_drift_columns_catchup.sql が列のみ追加し、当時 blog_authors が
--   migration-less だったため意図的に省略していた FK。blog_authors を上で back-port した
--   ことで参照先が fresh DB にも存在するようになったため、ここで FK を確立する。
--   本番には既に存在するため、存在チェック付き DO ブロックで no-op を保証する
--   （素の ADD CONSTRAINT は IF NOT EXISTS を持たず、本番で二重定義エラーになるため）。
-- --------------------------------------------------------------------------
DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'blog_posts_author_name_id_fkey'
      AND conrelid = 'public.blog_posts'::regclass
  ) THEN
    ALTER TABLE public.blog_posts
      ADD CONSTRAINT blog_posts_author_name_id_fkey
      FOREIGN KEY (author_name_id) REFERENCES public.blog_authors(id) ON DELETE SET NULL;
  END IF;
END
$fk$;

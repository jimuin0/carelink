-- 2026-06-29: facility_qa の質問/回答 文字数 CHECK を本番一致で fresh-apply に補完（制約ドリフト根治）。
--
-- 背景（事実・本番 pg_constraint 全件と fresh-apply の機械突合で確定）:
--   本番（ref: xzafxiupbflvgbarrihe）には以下2つの CHECK が存在するが、
--     facility_qa_question_check CHECK (length(question) <= 500)
--     facility_qa_answer_check   CHECK (length(answer)   <= 1000)
--   migration（20260417000024_phase7_hpb_extensions.sql の CREATE TABLE facility_qa）には
--   これらが無く、fresh-apply（supabase start＝CI/E2E のローカル DB）に CHECK が欠落していた
--   （本番では length 上限が効くが fresh-apply では効かない＝制約ドリフト）。
--
-- 方針: 本番定義に一致する CHECK を冪等に追加（DROP IF EXISTS → ADD）。本番では既存のため実質 no-op。
--   既存行は本番で既に上限内のため ADD は失敗しない（fresh-apply は空テーブル）。

ALTER TABLE facility_qa DROP CONSTRAINT IF EXISTS facility_qa_question_check;
ALTER TABLE facility_qa ADD CONSTRAINT facility_qa_question_check CHECK (length(question) <= 500);

ALTER TABLE facility_qa DROP CONSTRAINT IF EXISTS facility_qa_answer_check;
ALTER TABLE facility_qa ADD CONSTRAINT facility_qa_answer_check CHECK (length(answer) <= 1000);

-- area_seo_contents: UNIQUE 制約名を本番一致に揃える（fresh-apply==本番 を制約名レベルでも一致）。
-- 本番は明示名 area_seo_contents_pref_city_type_unique。fresh-apply は CREATE TABLE 内 inline UNIQUE で
-- PG 自動命名（..._prefecture_slug_city_slug_business_type_s_key）になり名前だけ乖離（enforcement は同一）。
-- 冪等: 自動名・明示名の両方を DROP IF EXISTS してから明示名で ADD。
ALTER TABLE area_seo_contents DROP CONSTRAINT IF EXISTS area_seo_contents_prefecture_slug_city_slug_business_type_s_key;
ALTER TABLE area_seo_contents DROP CONSTRAINT IF EXISTS area_seo_contents_pref_city_type_unique;
ALTER TABLE area_seo_contents ADD CONSTRAINT area_seo_contents_pref_city_type_unique UNIQUE (prefecture_slug, city_slug, business_type_slug);

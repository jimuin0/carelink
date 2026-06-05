-- 20260602000003_drift_repair.sql からの分割 (2/5) — CLI バージョン非依存化。
-- 「引数付き CREATE FUNCTION の直後に別文が続く」ファイルは CLI 2.75.0 系の文分割器が
-- 42601 を起こす（2.104.0 で修正済）ため、find_bulk_review_ips を本ファイル末尾に置く。
-- facility_reviews への reviewer_ip 列追加→public_reviews ビュー→find_bulk の順（依存順）。
-- find_bulk の REVOKE/GRANT は 20260602000009 へ分離（関数の後続にしないため）。冪等。

-- -----------------------------------------------------------------------------
-- (D) facility_reviews 不正検知列（20260417_review_flagging.sql）
-- -----------------------------------------------------------------------------
ALTER TABLE facility_reviews
  ADD COLUMN IF NOT EXISTS reviewer_ip TEXT,
  ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flag_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_reviews_ip ON facility_reviews(reviewer_ip)
  WHERE reviewer_ip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_flagged ON facility_reviews(is_flagged)
  WHERE is_flagged = TRUE;

-- reviewer_ip(PII) を一般 authenticated 読み取りから隠す（20260420_reviews_ip_protection.sql）
-- USING(true) の広すぎる auth_read_reviews を施設メンバー限定に差し替え。冪等化のため再作成。
DROP POLICY IF EXISTS "auth_read_reviews" ON facility_reviews;
DROP POLICY IF EXISTS "facility_reviews_member_read" ON facility_reviews;
CREATE POLICY "facility_reviews_member_read" ON facility_reviews
  FOR SELECT TO authenticated
  USING (
    facility_id IN (
      SELECT facility_id FROM facility_members
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- anon 直 INSERT を塞ぐ（20260420_reviews_anon_insert_rls.sql）。
-- 全レビュー投稿は POST /api/review（service_role）経由。直 INSERT は reCAPTCHA /
-- レート制限 / reviewer_ip 記録 / 重複チェック / CSRF を全て迂回するため廃止。
DROP POLICY IF EXISTS "Anyone can insert reviews" ON facility_reviews;

-- -----------------------------------------------------------------------------
-- (D2) public_reviews ビュー（20260420_public_reviews_view.sql の根本修正版）
--   原本は存在しない user_id 列を SELECT していたため CREATE VIEW が 42703 で失敗し、
--   ① public_reviews 未作成（PGRST205）② 同 migration 末尾の DROP POLICY 未実行
--   （anon が facility_reviews を直 SELECT 可能なまま = reviewer_ip 露出予備軍）
--   という二重ドリフトを起こしていた。2026-06-02 ライブ実測で確定:
--     - GET /rest/v1/public_reviews            → 404 PGRST205（ビュー無し）
--     - GET /rest/v1/facility_reviews (anon)   → 200 + rows（直読み可能）
--     - facility_reviews.user_id               → 400（列が存在しない）
--   user_id を除いた正しい定義で再作成する。公開読み取り経路（ReviewTab.tsx /
--   lib/facilities.ts:getFacilityReviews）は既に public_reviews を参照しており、
--   select('*') のみで user_id に依存しないため無影響。
CREATE OR REPLACE VIEW public_reviews
  WITH (security_invoker = false)  -- SECURITY DEFINER 相当（所有者=postgres 権限で実行）
AS
  SELECT
    id,
    facility_id,
    reviewer_name,
    rating,
    rating_skill,
    rating_service,
    rating_atmosphere,
    rating_cleanliness,
    rating_explanation,
    comment,
    photo_urls,
    is_verified_visit,
    status,
    created_at
  FROM facility_reviews
  WHERE status = 'published';

GRANT SELECT ON public_reviews TO anon, authenticated;

-- public_reviews 導入後、anon の facility_reviews 直 SELECT ポリシーを撤去。
-- anon は published のみ・reviewer_ip を含まない public_reviews 経由で読む。
DROP POLICY IF EXISTS "Public read published reviews" ON facility_reviews;

-- -----------------------------------------------------------------------------
-- (E) find_bulk_review_ips() — cron/flag-reviews が呼ぶが migration 未定義だった恒久新規
--     同一 IP から p_since 以降に p_threshold 件以上投稿した IP を返す。
--     src/app/api/cron/flag-reviews/route.ts: { p_since, p_threshold } → row.reviewer_ip
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION find_bulk_review_ips(
  p_since     TIMESTAMPTZ,
  p_threshold INT
)
RETURNS TABLE(reviewer_ip TEXT) AS $$
  SELECT fr.reviewer_ip
  FROM facility_reviews fr
  WHERE fr.created_at >= p_since
    AND fr.reviewer_ip IS NOT NULL
  GROUP BY fr.reviewer_ip
  HAVING COUNT(*) >= p_threshold;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

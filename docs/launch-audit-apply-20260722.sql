-- =============================================================================
-- CareLink ローンチ品質監査 本番適用バッチ（2026年7月22日・1回で全適用）
-- 適用者：神原さん（Supabase Dashboard → SQL Editor に本ファイル全文を貼って Run）
-- 中身：PR #521 に同梱した 5 本の migration（20260722000001〜000005）を適用順に結合したもの。
--       version 管理下の migration と完全一致（E2E の supabase start が同一SQLを適用して検証済み）。
-- 特性：全体を BEGIN…COMMIT で囲む＝どこかで失敗したら全ロールバック（中途半端な適用が起きない）。
-- 適用後：(1) 末尾の「検証SQL」を1つずつ実行して期待結果を確認、
--         (2) database.types.ts を再生成（enqueue_moderation を types に反映）、
--         (3) Claude に「適用完了」と伝える → Claude が PR #521 の pending 台帳エントリを外しマージ。
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 【1/5・監査H2/H3 low】moderation_queue の重複pending投入を DB 側で原子的に排除
--   （migration 20260722000001）
-- ─────────────────────────────────────────────────────────────────────────────

-- 既存の重複 pending 行を先に解消（残っていると下の部分ユニークindex 作成が 23505 で失敗）。
-- 各 (content_type, content_id) の pending 群を最古1件へ収斂。fresh DB では no-op。
DELETE FROM moderation_queue m
USING (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY content_type, content_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM moderation_queue
  WHERE status = 'pending'
) d
WHERE m.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_moderation_pending_content
  ON moderation_queue (content_type, content_id) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION enqueue_moderation(p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer;
BEGIN
  INSERT INTO moderation_queue (content_type, content_id, facility_id, reporter_id, report_reason, auto_flags, status)
  SELECT
    x.content_type,
    x.content_id,
    x.facility_id,
    x.reporter_id,
    x.report_reason,
    COALESCE(x.auto_flags, '[]'::jsonb),
    'pending'
  FROM jsonb_to_recordset(p_items) AS x(
    content_type  text,
    content_id    uuid,
    facility_id   uuid,
    reporter_id   uuid,
    report_reason text,
    auto_flags    jsonb
  )
  ON CONFLICT (content_type, content_id) WHERE status = 'pending' DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION enqueue_moderation(jsonb) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 【2/5・監査C1】キーワード検索を最寄駅名でも一致（facility_card_view に nearest_station 射影）
--   （migration 20260722000002）
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW facility_card_view AS
SELECT
  fp.id,
  fp.slug,
  fp.name,
  fp.business_type,
  fp.catch_copy,
  fp.description,
  fp.prefecture,
  fp.city,
  fp.access_info,
  fp.rating_avg,
  fp.rating_count,
  fp.main_photo_url,
  fp.business_hours,
  fp.seat_count,
  fp.status,
  fp.latitude,
  fp.longitude,
  fp.features,
  fp.created_at,
  COALESCE(menu_agg.min_price, NULL) AS min_price,
  COALESCE(menu_agg.max_price, NULL) AS max_price,
  COALESCE(menu_agg.menu_count, 0) AS menu_count,
  COALESCE(coupon_agg.coupon_count, 0) AS coupon_count,
  COALESCE(photo_agg.photo_count, 0) AS photo_count,
  fp.google_rating,
  fp.google_review_count,
  fp.nearest_station
FROM facility_profiles fp
LEFT JOIN LATERAL (
  SELECT
    MIN(price) AS min_price,
    MAX(price) AS max_price,
    COUNT(*)::INT AS menu_count
  FROM facility_menus
  WHERE facility_id = fp.id AND price IS NOT NULL
) menu_agg ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::INT AS coupon_count
  FROM coupons
  WHERE facility_id = fp.id AND is_active = true
) coupon_agg ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::INT AS photo_count
  FROM facility_photos
  WHERE facility_id = fp.id
) photo_agg ON true
WHERE fp.status = 'published';

GRANT SELECT ON facility_card_view TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 【3/5・監査H3】フラグ済みレビューを公開表示・平均点集計から自動除外
--   （migration 20260722000003）
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public_reviews
  WITH (security_invoker = false)
AS
  SELECT
    id, facility_id, reviewer_name, rating, rating_skill, rating_service,
    rating_atmosphere, rating_cleanliness, rating_explanation, comment, photo_urls,
    is_verified_visit, status, created_at
  FROM facility_reviews
  WHERE status = 'published' AND is_flagged = FALSE;

CREATE OR REPLACE FUNCTION update_facility_rating()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE facility_profiles SET
      rating_avg = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 1)
        FROM facility_reviews
        WHERE facility_id = NEW.facility_id AND status = 'published' AND is_flagged = FALSE
      ), 0),
      rating_count = (
        SELECT COUNT(*)
        FROM facility_reviews
        WHERE facility_id = NEW.facility_id AND status = 'published' AND is_flagged = FALSE
      )
    WHERE id = NEW.facility_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE facility_profiles SET
      rating_avg = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 1)
        FROM facility_reviews
        WHERE facility_id = OLD.facility_id AND status = 'published' AND is_flagged = FALSE
      ), 0),
      rating_count = (
        SELECT COUNT(*)
        FROM facility_reviews
        WHERE facility_id = OLD.facility_id AND status = 'published' AND is_flagged = FALSE
      )
    WHERE id = OLD.facility_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

UPDATE facility_profiles fp SET
  rating_avg = COALESCE((
    SELECT ROUND(AVG(r.rating)::numeric, 1) FROM facility_reviews r
    WHERE r.facility_id = fp.id AND r.status = 'published' AND r.is_flagged = FALSE
  ), 0),
  rating_count = (
    SELECT COUNT(*) FROM facility_reviews r
    WHERE r.facility_id = fp.id AND r.status = 'published' AND r.is_flagged = FALSE
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 【4/5・監査L4】customers / customer_visits の RLS を owner/admin ロールに限定
--   （migration 20260722000004）
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "customers_member_read"   ON customers;
DROP POLICY IF EXISTS "customers_member_insert" ON customers;
DROP POLICY IF EXISTS "customers_member_update" ON customers;
DROP POLICY IF EXISTS "customers_member_delete" ON customers;
CREATE POLICY "customers_member_read"   ON customers FOR SELECT USING (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = customers.facility_id AND user_id = auth.uid() AND role IN ('owner','admin')));
CREATE POLICY "customers_member_insert" ON customers FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = customers.facility_id AND user_id = auth.uid() AND role IN ('owner','admin')));
CREATE POLICY "customers_member_update" ON customers FOR UPDATE USING (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = customers.facility_id AND user_id = auth.uid() AND role IN ('owner','admin')));
CREATE POLICY "customers_member_delete" ON customers FOR DELETE USING (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = customers.facility_id AND user_id = auth.uid() AND role IN ('owner','admin')));

DROP POLICY IF EXISTS "customer_visits_member_read"   ON customer_visits;
DROP POLICY IF EXISTS "customer_visits_member_insert" ON customer_visits;
CREATE POLICY "customer_visits_member_read"   ON customer_visits FOR SELECT USING (
  EXISTS (SELECT 1 FROM facility_members fm WHERE fm.facility_id = customer_visits.facility_id AND fm.user_id = auth.uid() AND fm.role IN ('owner','admin')));
CREATE POLICY "customer_visits_member_insert" ON customer_visits FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM facility_members fm WHERE fm.facility_id = customer_visits.facility_id AND fm.user_id = auth.uid() AND fm.role IN ('owner','admin')));


-- ─────────────────────────────────────────────────────────────────────────────
-- 【5/5・監査L2】問診テンプレの UNIQUE(facility_id,is_active) を「アクティブ1件」の部分ユニークへ
--   （migration 20260722000005）
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  WHERE c.conrelid = 'intake_form_templates'::regclass
    AND c.contype = 'u'
    AND c.conkey = ARRAY[
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'intake_form_templates'::regclass AND attname = 'facility_id'),
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'intake_form_templates'::regclass AND attname = 'is_active')
    ]::smallint[]
  LIMIT 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE intake_form_templates DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_intake_active_per_facility
  ON intake_form_templates (facility_id) WHERE is_active;


COMMIT;

-- =============================================================================
-- 検証SQL（COMMIT 後に1つずつ実行して期待結果を確認する。ここから下は適用文ではない）
-- =============================================================================

-- 【1】enqueue_moderation 関数が存在する（期待：1行）
-- SELECT proname FROM pg_proc WHERE proname = 'enqueue_moderation';

-- 【1】moderation の pending 部分ユニークindex が存在する（期待：1行）
-- SELECT indexname FROM pg_indexes WHERE indexname = 'uq_moderation_pending_content';

-- 【2】facility_card_view が nearest_station 列を返す（期待：列が存在・エラーにならない）
-- SELECT nearest_station FROM facility_card_view LIMIT 1;

-- 【3】public_reviews にフラグ済みが出ない（期待：0）
-- SELECT count(*) FROM public_reviews pr JOIN facility_reviews r ON r.id = pr.id WHERE r.is_flagged;

-- 【4】customers の RLS ポリシーが role 限定になっている（期待：4行・qual に owner/admin を含む）
-- SELECT policyname, qual FROM pg_policies WHERE tablename = 'customers' AND policyname LIKE 'customers_member_%';

-- 【5】問診テンプレの部分ユニークindex が存在する（期待：1行）
-- SELECT indexname FROM pg_indexes WHERE indexname = 'uq_intake_active_per_facility';

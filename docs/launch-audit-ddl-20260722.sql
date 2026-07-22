-- =============================================================================
-- CareLink ローンチ品質監査 DDL バンドル（2026年7月22日）
-- 適用者：神原さん（Supabase SQL Editor）。適用後に schema-snapshot.json を再取得すること。
-- 各ブロックは現行定義（該当 migration）を根拠に、監査で判明した欠落のみを最小変更したもの。
-- コード側（PR #518）は適用済み。DDL はコードでは直せない部分（view/function/制約/RLS）。
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 【H3】自動フラグ／通報されたレビューを「公開表示」と「平均点集計」からも除外する
-- 現状：flag-reviews cron が is_flagged=true を立て、審査却下で status='hidden' になるが、
--   審査前の is_flagged=true レビューは public_reviews（status='published' のみ）に表示され続け、
--   update_facility_rating（同じく status='published' 集計）にも算入され続ける。
-- 仮説：public_reviews と update_facility_rating の集計条件に is_flagged=FALSE を足せば、
--   フラグ済みレビューが「審査完了まで公開表示・平均点から自動的に外れる」。
-- 検証：適用後、is_flagged=true のレビューが public_reviews に出ないこと・当該施設の
--   rating_avg/rating_count が再計算で減ることを SELECT で確認。
-- 出典：public_reviews=20260602000008 / update_facility_rating=20260322000001

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

-- 既存レビューの rating を全施設で再計算（フラグ済みを除外した値へ更新）。トリガは
-- 今後の INSERT/UPDATE/DELETE で発火するため、既存分は下の一括再計算で追従させる。
UPDATE facility_profiles fp SET
  rating_avg = COALESCE((
    SELECT ROUND(AVG(r.rating)::numeric, 1) FROM facility_reviews r
    WHERE r.facility_id = fp.id AND r.status = 'published' AND r.is_flagged = FALSE
  ), 0),
  rating_count = (
    SELECT COUNT(*) FROM facility_reviews r
    WHERE r.facility_id = fp.id AND r.status = 'published' AND r.is_flagged = FALSE
  );

-- 検証SQL：
-- SELECT count(*) FROM public_reviews pr JOIN facility_reviews r ON r.id = pr.id WHERE r.is_flagged; -- 期待 0


-- ─────────────────────────────────────────────────────────────────────────────
-- 【L4】customers / customer_visits の RLS を owner/admin ロールに限定する
-- 現状：RLS は「施設メンバーであること」のみ検証しロールを問わない（20260620000003 / 20260323000004）。
--   Supabase 既定 GRANT と組み合わさると、将来 staff/viewer 会員に対し機微な顧客台帳への直接
--   CRUD を許す潜在的なテナント内権限逸脱。アプリ層は owner/admin のみ想定。
-- 仮説：RLS の EXISTS 条件に role IN ('owner','admin') を足せば DB 側も最小権限に揃う。
--   書き込みAPIは service_role で RLS を迂回するため通常運用に影響しない（読み取り整合のみ厳格化）。
-- 検証：staff ロールの会員 JWT で customers を SELECT して 0 行になること（owner は従来どおり）。

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
-- 【L2】問診テンプレの UNIQUE(facility_id, is_active) を「アクティブ1件」の部分ユニークに直す
-- 現状：UNIQUE(facility_id, is_active)（20260417000019）は「非アクティブも施設あたり1件まで」に
--   なる意図しない制約。テンプレ管理UI未実装のため即時発症はしないが設計欠陥。
-- 仮説：複合 UNIQUE を撤去し、is_active=TRUE の部分ユニークインデックスに置換すれば
--   「アクティブは施設あたり1件・非アクティブは無制限」の本来意図になる。
-- 検証：同一施設で is_active=false のテンプレを2件 INSERT できること・is_active=true は1件までに拒否されること。
-- 注：制約名は環境依存。実際の名前は下の確認SQLで取得してから DROP すること。
--   SELECT conname FROM pg_constraint WHERE conrelid='intake_form_templates'::regclass AND contype='u';

ALTER TABLE intake_form_templates DROP CONSTRAINT IF EXISTS intake_form_templates_facility_id_is_active_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_intake_active_per_facility
  ON intake_form_templates (facility_id) WHERE is_active;


-- ─────────────────────────────────────────────────────────────────────────────
-- 【C1】キーワード検索を最寄駅名でも一致させる（facility_card_view に nearest_station を射影）
-- 現状：facility_card_view は nearest_station を射影せず access_info のみ。PR #518 のコード修正は
--   クラッシュ（存在しない列参照の400全滅）を access_info への差替で止めたが、GPS経路が使う専用列
--   nearest_station での駅名検索は非GPS経路で失われている（症状は止まったが完全対称ではない）。
-- 仮説：view に fp.nearest_station を末尾追加すれば、コード側で access_info に加え nearest_station も
--   .or() 検索対象にできて GPS/非GPS の駅名検索が対称になる。
-- 検証：適用後、SELECT nearest_station FROM facility_card_view LIMIT 1; が列を返すこと。
-- ★適用後、Claude が facilities.ts の .or() に nearest_station.ilike を追加する（DDL 先・コード後の順）。
-- 出典：facility_card_view=20260615000002

CREATE OR REPLACE VIEW facility_card_view AS
SELECT
  fp.id, fp.slug, fp.name, fp.business_type, fp.catch_copy, fp.description,
  fp.prefecture, fp.city, fp.access_info, fp.nearest_station,
  fp.rating_avg, fp.rating_count, fp.main_photo_url, fp.business_hours,
  fp.seat_count, fp.status, fp.latitude, fp.longitude, fp.features, fp.created_at,
  COALESCE(menu_agg.min_price, NULL) AS min_price,
  COALESCE(menu_agg.max_price, NULL) AS max_price,
  COALESCE(menu_agg.menu_count, 0) AS menu_count,
  COALESCE(coupon_agg.coupon_count, 0) AS coupon_count,
  COALESCE(photo_agg.photo_count, 0) AS photo_count,
  fp.google_rating, fp.google_review_count
FROM facility_profiles fp
LEFT JOIN LATERAL (
  SELECT MIN(price) AS min_price, MAX(price) AS max_price, COUNT(*)::INT AS menu_count
  FROM facility_menus WHERE facility_id = fp.id AND price IS NOT NULL
) menu_agg ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::INT AS coupon_count FROM coupons WHERE facility_id = fp.id AND is_active = true
) coupon_agg ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::INT AS photo_count FROM facility_photos WHERE facility_id = fp.id
) photo_agg ON true
WHERE fp.status = 'published';

GRANT SELECT ON facility_card_view TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 【H2/H3 low・任意強化】通報・自動フラグの moderation_queue 重複pending投入の競合を防ぐ
-- 現状：/api/report と cron/flag-reviews は「pending 既存を SELECT → 無ければ INSERT」の
--   best-effort dedup。並行通報や別cronが SELECT と INSERT の間に割り込むと同一コンテンツの
--   pending 行が重複挿入され得る（実害＝審査画面に同一カードが複数並ぶ・却下は冪等で機能破綻なし・
--   検証で low/自己解消と判定）。
-- 仮説：pending に限定した部分ユニークindex で「同一コンテンツの pending は1件」をDB側で保証すれば
--   競合時の2件目 INSERT が 23505 で弾かれ重複を根絶できる（approve/reject 後の再フラグは status が
--   変わるため引き続き可能＝部分indexで正しく共存）。
-- 【重要・適用前提】このindexを入れる場合はコード側の追従が必須：
--   (a) /api/report(単一INSERT) は 23505 を「既に審査キュー登録済み」として無害扱い（アラート抑止）。
--   (b) cron/flag-reviews(バッチINSERT) は 23505 でバッチ全体が失敗し新規行を取りこぼすため、
--       .upsert(ignoreDuplicates) か per-row INSERT へ変更が必要。
--   → コード追従なしにindexだけ入れるとアラートノイズ/取りこぼしを招くため、適用する場合は
--     Claude にコード側の同時対応を指示すること（DDL単独適用は非推奨）。
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_moderation_pending_content
--   ON moderation_queue (content_type, content_id) WHERE status = 'pending';

-- 【監査H3・恒久根治のDDL部】フラグ済みレビューを公開表示・平均点集計から自動除外する。
-- flag-reviews cron は is_flagged=true を立て審査キューに載せるが、審査前の is_flagged=true レビューは
-- public_reviews（status='published' のみ）に表示され続け、update_facility_rating（同じく published 集計）
-- にも算入され続けていた。両集計条件に is_flagged=FALSE を足し、審査完了まで自動で公開表示・平均点から
-- 外れるようにする。is_flagged は BOOLEAN NOT NULL DEFAULT FALSE のため NULL は考慮不要。

-- public_reviews（出典：20260602000008）に AND is_flagged = FALSE を追加。
CREATE OR REPLACE VIEW public_reviews
  WITH (security_invoker = false)
AS
  SELECT
    id, facility_id, reviewer_name, rating, rating_skill, rating_service,
    rating_atmosphere, rating_cleanliness, rating_explanation, comment, photo_urls,
    is_verified_visit, status, created_at
  FROM facility_reviews
  WHERE status = 'published' AND is_flagged = FALSE;

-- update_facility_rating（出典：20260322000001）の集計に AND is_flagged = FALSE を追加。
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

-- トリガは今後の INSERT/UPDATE/DELETE で発火。既存レビューぶんは一括再計算でフラグ除外に追従させる。
UPDATE facility_profiles fp SET
  rating_avg = COALESCE((
    SELECT ROUND(AVG(r.rating)::numeric, 1) FROM facility_reviews r
    WHERE r.facility_id = fp.id AND r.status = 'published' AND r.is_flagged = FALSE
  ), 0),
  rating_count = (
    SELECT COUNT(*) FROM facility_reviews r
    WHERE r.facility_id = fp.id AND r.status = 'published' AND r.is_flagged = FALSE
  );

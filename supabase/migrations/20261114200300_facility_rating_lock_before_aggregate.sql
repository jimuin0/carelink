-- 点検 B9-9（2026年11月14日）：口コミ評価の集計にロックが無く、同時の投稿・非表示で古い集計が勝ち得る。
--
-- READ COMMITTED では、UPDATE facility_profiles が行ロック待ちから再開しても SET 内の副問い合わせ（AVG・COUNT）は
-- 文の開始時点のスナップショットのまま再評価されない。2 件の口コミが同時に確定すると、後から書いた側が
-- 相手の行を含まない集計で上書きし、rating_avg / rating_count が実データとずれたまま残る（次の変更まで直らない）。
-- 集計の前に施設の行を FOR UPDATE で取り、ロック取得後の別の文（＝新しいスナップショット）で集計する。
-- 写し元: 20260822000001_rls_review_report_tenant_hardening.sql（全文。PERFORM ... FOR UPDATE を 2 行足しただけ）。
-- SECURITY DEFINER・search_path は同じ。CREATE OR REPLACE は 20261020140000 の REVOKE を保つ。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.update_facility_rating()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    -- 先に施設の行をロックし、取れた後の新しいスナップショットで集計する（同時投稿で古い集計が勝たない）。
    PERFORM 1 FROM facility_profiles WHERE id = NEW.facility_id FOR UPDATE;
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
    PERFORM 1 FROM facility_profiles WHERE id = OLD.facility_id FOR UPDATE;
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

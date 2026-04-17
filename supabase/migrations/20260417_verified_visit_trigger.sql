-- 来店確認バッジ自動設定トリガー（v8.14）
-- facility_reviews INSERT時に、completed予約の存在をDB側で確認して
-- is_verified_visitを自動設定する（クライアント側の値は無視）

CREATE OR REPLACE FUNCTION fn_set_review_verified_visit()
RETURNS TRIGGER AS $$
BEGIN
  -- user_idがある場合のみ来店確認チェック（匿名レビューはfalseのまま）
  IF NEW.user_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1
      FROM bookings
      WHERE facility_id = NEW.facility_id
        AND user_id = NEW.user_id
        AND status = 'completed'
    ) INTO NEW.is_verified_visit;
  ELSE
    NEW.is_verified_visit := FALSE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 既存トリガーがあれば削除してから再作成
DROP TRIGGER IF EXISTS trg_review_verified_visit ON facility_reviews;

CREATE TRIGGER trg_review_verified_visit
  BEFORE INSERT ON facility_reviews
  FOR EACH ROW EXECUTE FUNCTION fn_set_review_verified_visit();

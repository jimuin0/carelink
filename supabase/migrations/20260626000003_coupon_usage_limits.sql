-- 2026年6月26日: クーポンの使用制限（総上限＋1人1回）を実装（神原さん確定仕様）。
--
-- 背景（事実・敵対監査 予-1 で確定）:
--   coupons テーブルには使用回数・1人あたり回数の制限カラムが皆無で、
--   src/app/api/booking/route.ts のクーポン適用は is_active/valid_from/valid_until のみ検証。
--   使用回数のカウントアップもチェックも全コードに存在せず、同一ユーザーが同一クーポンを
--   何度でも適用でき、総発行枚数の上限も効かなかった（金銭損失リスク）。
--
-- 修正（発症前の真の予防）:
--   1. coupons.max_uses（総使用上限・NULL=無制限）を追加。
--   2. coupon_redemptions 台帳を新設。1人1回は部分 UNIQUE(coupon_id,user_id) WHERE user_id IS NOT NULL で
--      DB レベルに担保（匿名予約=user_id NULL は本人特定不能のため総上限のみ適用）。
--   3. create_booking_atomic を CREATE OR REPLACE し、クーポン適用予約の
--      「coupon 行 FOR UPDATE ロック → 総上限チェック → 予約 INSERT → redemption INSERT」を
--      1トランザクション・同一 advisory lock 下で実行（TOCTOU 完全排除）。
--      総上限は coupon 行ロックで全システム横断に直列化し、1人1回は UNIQUE 違反捕捉で確定。
--
-- 仕様メモ（神原さん確認事項）:
--   redemption は予約作成時に記録し、予約キャンセル（status 変更・物理削除なし）では解放しない
--   ＝キャンセルしてもクーポン消費は維持（過剰発行を防ぐ安全側）。キャンセル時の消費返却が必要なら
--   別 PR で cancel 経路に redemption 削除を追加する。
--
-- 冪等性: 各 DDL は IF NOT EXISTS / CREATE OR REPLACE を用いるため再適用しても安全。

-- 1. 総使用上限カラム（NULL = 無制限）
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_uses INT;

-- 2. 使用台帳
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- 退会後も消費記録を保全（NULL化）
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 総上限カウント用インデックス
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions(coupon_id);

-- 1人1回（user_id がある予約のみ。匿名は対象外）
CREATE UNIQUE INDEX IF NOT EXISTS uq_coupon_redemptions_coupon_user
  ON coupon_redemptions(coupon_id, user_id) WHERE user_id IS NOT NULL;

-- RLS: 台帳はサーバ信頼文脈（SECURITY DEFINER RPC / service role）のみが書き込む。
-- anon/authenticated への INSERT/UPDATE ポリシーは作らない（=直接書き込み不可）。
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;

-- 3. create_booking_atomic にクーポン使用制限を組み込み（20260621000001 の本体＋クーポン制御）。
CREATE OR REPLACE FUNCTION create_booking_atomic(
  p_facility_id UUID,
  p_staff_id UUID,
  p_user_id UUID,
  p_menu_id UUID,
  p_coupon_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_customer_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_note TEXT,
  p_total_price INT,
  p_points_used INT DEFAULT 0,
  p_status TEXT DEFAULT 'pending'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id UUID;
  v_conflict_count INT;
  v_active_staff INT;
  v_lock_key BIGINT;
  v_max_uses INT;
  v_redemption_count INT;
BEGIN
  -- ロックキーは「施設 + 予約日」。指名あり/なしを問わず当該施設・当該日の予約書き込みを直列化。
  v_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF p_staff_id IS NOT NULL THEN
    -- 指名あり: 当該スタッフの同時間帯重複は不可。
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  ELSE
    -- 指名なし(おまかせ): 同時間帯に重なる予約数がアクティブ施術者数に達していたら満席=競合。
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;

    SELECT COUNT(*) INTO v_active_staff
    FROM staff_profiles
    WHERE facility_id = p_facility_id
      AND is_active = true;

    IF v_conflict_count >= v_active_staff THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  END IF;

  -- クーポン使用制限（総上限）: coupon 行を FOR UPDATE でロックし、同一クーポンの並行 redemption を
  -- 全システム横断で直列化する（advisory lock は施設+日付単位のため別キーのクーポン競合を直列化できない）。
  IF p_coupon_id IS NOT NULL THEN
    SELECT max_uses INTO v_max_uses FROM coupons WHERE id = p_coupon_id FOR UPDATE;
    IF v_max_uses IS NOT NULL THEN
      SELECT COUNT(*) INTO v_redemption_count FROM coupon_redemptions WHERE coupon_id = p_coupon_id;
      IF v_redemption_count >= v_max_uses THEN
        RAISE EXCEPTION 'COUPON_LIMIT: このクーポンは利用上限に達しています';
      END IF;
    END IF;
  END IF;

  INSERT INTO bookings (
    facility_id, staff_id, user_id, menu_id, coupon_id,
    booking_date, start_time, end_time,
    customer_name, email, phone, note,
    total_price, points_used, status
  ) VALUES (
    p_facility_id, p_staff_id, p_user_id, p_menu_id, p_coupon_id,
    p_booking_date, p_start_time, p_end_time,
    p_customer_name, p_email, p_phone, p_note,
    p_total_price, p_points_used, p_status
  )
  RETURNING id INTO v_booking_id;

  -- redemption 記録。1人1回は UNIQUE 違反で確定的に弾く（トランザクション全体がロールバック＝予約も取消）。
  IF p_coupon_id IS NOT NULL THEN
    BEGIN
      INSERT INTO coupon_redemptions (coupon_id, user_id, booking_id)
      VALUES (p_coupon_id, p_user_id, v_booking_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'COUPON_ALREADY_USED: このクーポンは既に利用済みです';
    END;
  END IF;

  RETURN v_booking_id;
END;
$$;

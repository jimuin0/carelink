-- 2026年7月17日: create_booking_atomic の指名スタッフ勤務窓ゲートを G1 所属チェックの直後へ移動する。
--
-- 背景（事実・#492/#502 敵対検証での指摘）:
--   20260716000002 で追加した p_enforce_schedule=TRUE 時のゲートのうち、指名スタッフ勤務窓ゲート
--   （b. schedule_overrides / staff_schedules を見て STAFF_NOT_WORKING を返す判定）が、既存の
--   G1 所属チェック（PERFORM 1 FROM staff_profiles WHERE id = p_staff_id AND facility_id = p_facility_id
--   → 不一致なら STAFF_NOT_IN_FACILITY）より前に実行される順序になっていた。
--   このため他施設の staff_id を渡した場合（当該施設に所属していないスタッフを指名した場合）に、
--   本来返すべき「所属していません（STAFF_NOT_IN_FACILITY）」ではなく「勤務していません
--   （STAFF_NOT_WORKING）」という不正確なエラー種別が先に返っていた。
--   どちらの分岐でも予約は拒否されるためセキュリティホールではない（fail-closed は維持されている）。
--   純粋にエラーメッセージ／エラーコードの正確性の問題。change_booking_atomic は変更対象予約から
--   staff_id を取得する（他施設 staff_id を新規に受け付ける経路が無い）ため本件の対象外・無変更。
--
-- 修正（発症前の予防・構造の入れ替えのみ）:
--   指名スタッフ勤務窓ゲート（IF p_staff_id IS NOT NULL THEN ... schedule_overrides /
--   staff_schedules ... END IF のブロック）を、G1 所属チェックの直後・既存予約重複チェックの前へ
--   移動する。判定ロジック・RAISE するメッセージ・変数名は一切変更しない（コピー移動のみ）。
--   移動先では p_enforce_schedule=FALSE 時に発効させないよう IF p_enforce_schedule THEN で
--   再度ガードする（従来どおり公開経路のみ強制・admin 手動予約は対象外という契約を維持）。
--   business_hours ゲート（a.）は現在位置（p_enforce_schedule ブロック内・p_staff_id 分岐より前）
--   のまま変更しない。バッファ・G2 勤務分母・クーポン・INSERT は一切触らない。
--
--   修正後の実行順序（指名予約・p_enforce_schedule=TRUE の場合）:
--     (1) business_hours ゲート（定休日／営業時間外）
--     (2) G1 所属チェック（STAFF_NOT_IN_FACILITY）
--     (3) 指名スタッフ勤務窓ゲート（STAFF_NOT_WORKING）
--     (4) 既存予約重複チェック（BOOKING_CONFLICT）
--
-- 挙動互換性:
--   本 SQL は挙動互換（拒否される予約は移動前後で完全に同一集合のまま・変わるのは
--   G1/勤務窓の両方に該当するケースで返るエラー種別が STAFF_NOT_WORKING → STAFF_NOT_IN_FACILITY に
--   正確化される点のみ）。新規パラメータ追加・削除は無く、シグネチャは 20260716000002 と
--   同一の16引数のまま。TS 側の呼び出し・エラーマッピングは無変更（3種のエラーコードは
--   20260716000002 の時点で既に対応済み）。このため本 SQL は DDL 先行・TS デプロイ先行の
--   どちらの順序で適用しても安全（新規に必須化される引数・エラーコードが無いため）。
--
-- 冪等性: DROP FUNCTION IF EXISTS（16引数版）してから CREATE するため再適用安全。
--   GRANT / REVOKE も何度実行しても安全。
--
-- 権限: CREATE は既定で PUBLIC に EXECUTE を付与するため（20260704000002 / 20260716000002 と
--   同じ理由）、CREATE 直後に service_role へ明示 GRANT し、PUBLIC / anon / authenticated から
--   REVOKE する。anon / authenticated は PUBLIC のメンバーのため PUBLIC からの REVOKE が必須。
--
-- 対象外: change_booking_atomic は本 SQL で一切変更しない（20260716000002 の定義のまま）。

-- ============================================================================
-- create_booking_atomic（指名スタッフ勤務窓ゲートを G1 所属チェック直後へ移動）
-- ============================================================================
DROP FUNCTION IF EXISTS create_booking_atomic(
  UUID, UUID, UUID, UUID, UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, BOOLEAN
);

CREATE FUNCTION create_booking_atomic(
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
  p_status TEXT DEFAULT 'pending',
  p_enforce_schedule BOOLEAN DEFAULT FALSE
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
  v_dow INT;
  v_buffer_minutes INT;
  -- スケジュールゲート専用変数（既存ロジックの変数と共有しない＝既存挙動へ波及させない）
  v_business_hours JSONB;
  v_gate_dow INT;
  v_day_key TEXT;
  v_day_val JSONB;
  v_fac_open TIME;
  v_fac_close TIME;
  v_gate_is_holiday BOOLEAN;
  v_gate_work_start TIME;
  v_gate_work_end TIME;
BEGIN
  v_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- M-2: get_available_slots と同一のバッファを競合判定にも強制する。
  -- （スケジュールゲート用に business_hours も同じ SELECT で相乗り取得する）
  SELECT COALESCE(booking_buffer_minutes, 0), business_hours
  INTO v_buffer_minutes, v_business_hours
  FROM facility_profiles WHERE id = p_facility_id;

  -- スケジュールゲート a.（公開経路のみ p_enforce_schedule=TRUE で発効。get_available_slots ミラー）
  IF p_enforce_schedule THEN
    v_gate_dow := EXTRACT(DOW FROM p_booking_date)::int;

    -- a. business_hours ゲート（指名/おまかせ共通）。
    --    NULL / 非 object / 曜日キー不在はゲートしない（get_available_slots と同一解釈）。
    IF v_business_hours IS NOT NULL AND jsonb_typeof(v_business_hours) = 'object' THEN
      v_day_key := CASE v_gate_dow
        WHEN 0 THEN 'sun' WHEN 1 THEN 'mon' WHEN 2 THEN 'tue' WHEN 3 THEN 'wed'
        WHEN 4 THEN 'thu' WHEN 5 THEN 'fri' WHEN 6 THEN 'sat' END;
      v_day_val := v_business_hours -> v_day_key;
      IF v_day_val IS NOT NULL THEN                 -- 曜日キーが存在
        IF jsonb_typeof(v_day_val) = 'null' THEN
          RAISE EXCEPTION 'BOOKING_CLOSED_DAY: この日は定休日です';
        END IF;
        v_fac_open := (v_day_val ->> 'open')::time;
        v_fac_close := (v_day_val ->> 'close')::time;
        IF v_fac_open IS NOT NULL AND v_fac_close IS NOT NULL THEN
          IF p_start_time < v_fac_open OR p_end_time > v_fac_close THEN
            RAISE EXCEPTION 'BOOKING_OUTSIDE_HOURS: 営業時間外です';
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_staff_id IS NOT NULL THEN
    -- G1: 指名スタッフが当該施設に所属することを検証（fail-closed）。
    PERFORM 1 FROM staff_profiles WHERE id = p_staff_id AND facility_id = p_facility_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STAFF_NOT_IN_FACILITY: 指定されたスタッフはこの施設に所属していません';
    END IF;

    -- スケジュールゲート b.（G1 所属チェックの直後・既存予約重複チェックの前。
    --    公開経路のみ p_enforce_schedule=TRUE で発効。get_available_slots と同じ優先順:
    --    schedule_overrides の当日行 → staff_schedules の当曜日行）。
    IF p_enforce_schedule THEN
      SELECT so.is_holiday, so.start_time, so.end_time
      INTO v_gate_is_holiday, v_gate_work_start, v_gate_work_end
      FROM schedule_overrides so
      WHERE so.staff_id = p_staff_id AND so.date = p_booking_date;

      IF FOUND AND v_gate_is_holiday THEN
        RAISE EXCEPTION 'STAFF_NOT_WORKING: このスタッフはこの日は勤務していません';
      END IF;

      IF v_gate_work_start IS NULL THEN
        SELECT ss.start_time, ss.end_time
        INTO v_gate_work_start, v_gate_work_end
        FROM staff_schedules ss
        WHERE ss.staff_id = p_staff_id AND ss.day_of_week = v_gate_dow;
      END IF;

      -- 勤務窓が取れない（end_time NULL 含む・NULL 比較で素通りさせない fail-closed）、
      -- または窓が [p_start_time, p_end_time] を包含しない → 拒否。
      IF v_gate_work_start IS NULL
        OR v_gate_work_end IS NULL
        OR v_gate_work_start > p_start_time
        OR v_gate_work_end < p_end_time THEN
        RAISE EXCEPTION 'STAFF_NOT_WORKING: このスタッフはこの日は勤務していません';
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL
      AND end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL
      AND end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time;

    -- G2: 分母を「その時間帯に勤務する is_active スタッフ数」に（get_available_slots をミラー）。
    v_dow := EXTRACT(DOW FROM p_booking_date)::int;
    SELECT COUNT(*) INTO v_active_staff
    FROM staff_profiles sp
    WHERE sp.facility_id = p_facility_id
      AND sp.is_active = true
      AND EXISTS (
        -- 相関サブクエリ: ダミー1行に対し当該スタッフ(sp.id)の当日 override と週間 schedule を
        -- LEFT JOIN し、勤務窓が予約時間帯を包含するか判定する（外部 sp.id は ON 句で参照＝相関で正当）。
        SELECT 1
        FROM (SELECT 1) dummy
        LEFT JOIN schedule_overrides so ON so.staff_id = sp.id AND so.date = p_booking_date
        LEFT JOIN staff_schedules ss ON ss.staff_id = sp.id AND ss.day_of_week = v_dow
        WHERE NOT (so.is_holiday IS TRUE)
          AND (CASE WHEN so.start_time IS NOT NULL THEN so.start_time ELSE ss.start_time END) IS NOT NULL
          AND (CASE WHEN so.start_time IS NOT NULL THEN so.start_time ELSE ss.start_time END) <= p_start_time
          AND (CASE WHEN so.start_time IS NOT NULL THEN so.end_time   ELSE ss.end_time   END) >= p_end_time
      );

    IF v_conflict_count >= v_active_staff THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  END IF;

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

-- CREATE は既定で PUBLIC に EXECUTE を付与するため、service_role 限定（20260704000002 /
-- 20260716000002 と同一方針）を同一シグネチャで再確立する。GRANT を先に行い service_role の
-- 実行権を保全してから REVOKE する。
GRANT EXECUTE ON FUNCTION create_booking_atomic(
  UUID, UUID, UUID, UUID, UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, BOOLEAN
) TO service_role;

REVOKE EXECUTE ON FUNCTION create_booking_atomic(
  UUID, UUID, UUID, UUID, UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated;

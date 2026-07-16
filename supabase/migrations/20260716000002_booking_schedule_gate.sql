-- 2026年7月16日: create_booking_atomic / change_booking_atomic に営業時間・定休日・指名スタッフ勤務窓ゲートを追加する。
--
-- 背景（事実）:
--   UI の枠表示 get_available_slots（20260703000004）は facility_profiles.business_hours と
--   staff_schedules / schedule_overrides でゲート済みだが、予約を実際に確定する権威側
--   （create_booking_atomic / change_booking_atomic・20260704000001 が最新定義）は非対称に未参照だった。
--     - 指名分岐: スタッフ勤務窓（staff_schedules / schedule_overrides）も施設営業時間
--       （facility_profiles.business_hours）も一切見ない → API 直叩きで深夜・定休日の指名予約が通る。
--     - おまかせ分岐: 勤務スタッフ数（G2）は見るが business_hours 未参照。staff_schedules が
--       月〜土で seed される施設では、木曜定休（business_hours.thu = null）でも木曜予約が通る
--       （本番実在: kanbara-shinkyuin-toyonaka 定休日 sun,thu）。
--
-- 修正（発症前の真の予防・get_available_slots の解釈を忠実にミラー）:
--   両関数の末尾に p_enforce_schedule BOOLEAN DEFAULT FALSE を追加し、TRUE のときのみ
--   競合判定の前に以下のゲートを実行する。既存ロジック（advisory lock・バッファ・G1 所属チェック・
--   G2 勤務分母・クーポン・INSERT/UPDATE）は 20260704000001 の定義を一字一句維持する。
--     a. business_hours ゲート（指名/おまかせ共通）:
--        business_hours が NULL / 非 object / 曜日キー不在 → ゲートしない（既存施設を壊さない・
--        get_available_slots と同一解釈）。曜日値が JSON null → 定休日 → RAISE BOOKING_CLOSED_DAY。
--        {open,close} が取れたら p_start_time < open OR p_end_time > close で RAISE BOOKING_OUTSIDE_HOURS。
--     b. 指名スタッフ勤務窓ゲート（staff_id が非 NULL の予約のみ）:
--        get_available_slots と同じ優先順（schedule_overrides の当日行が最優先。is_holiday=TRUE なら
--        RAISE STAFF_NOT_WORKING。override の start_time 非 NULL ならそれを勤務窓に、無ければ
--        staff_schedules の当曜日行）。勤務窓が取れない、または窓が [p_start_time, p_end_time] を
--        包含しない → RAISE STAFF_NOT_WORKING。
--
-- パラメータ追加は必ず DROP → CREATE で行う（CREATE OR REPLACE はシグネチャが異なるため
-- オーバーロード（旧15引数版と新16引数版の並存）を生む＝20260418000000 の過去事故と同型。
-- 旧版が残ると service_role 限定（20260704000002）を迂回する呼び出し面が残置される）。
--
-- 権限: CREATE は既定で PUBLIC に EXECUTE を付与するため（20260704000002 と同じ理由）、
--   CREATE 直後に service_role へ明示 GRANT し、PUBLIC / anon / authenticated から REVOKE する。
--   anon / authenticated は PUBLIC のメンバーのため PUBLIC からの REVOKE が必須。
--
-- 冪等性: 旧シグネチャ・新シグネチャの双方を DROP IF EXISTS してから CREATE するため再適用安全。
--   GRANT / REVOKE も何度実行しても安全。
--
-- ⚠️【適用順序（重要）】本 SQL は p_enforce_schedule DEFAULT FALSE のため先行適用が安全
--   （デプロイ済みの旧 TS コードは 15/5 引数の named args で呼ぶ → DEFAULT で補完され従来挙動のまま）。
--   TS デプロイ後に公開経路（booking/route.ts・change/route.ts）が p_enforce_schedule: true を渡して
--   発効する。逆順（TS デプロイが先）だと新コードが p_enforce_schedule を渡した時点で関数が
--   見つからず PGRST202 → 予約フロー停止。必ず本 SQL → TS デプロイの順で適用すること。
--   admin/bookings/route.ts はパラメータを渡さない＝DEFAULT FALSE＝店舗の手動予約（電話受付等の
--   意図的な時間外登録）はゲート対象外（意図的）。

-- ============================================================================
-- 1. create_booking_atomic
-- ============================================================================
DROP FUNCTION IF EXISTS create_booking_atomic(
  UUID, UUID, UUID, UUID, UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT
);
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

  -- スケジュールゲート（公開経路のみ p_enforce_schedule=TRUE で発効。get_available_slots ミラー）
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

    -- b. 指名スタッフ勤務窓ゲート（get_available_slots と同じ優先順:
    --    schedule_overrides の当日行 → staff_schedules の当曜日行）。
    IF p_staff_id IS NOT NULL THEN
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
  END IF;

  IF p_staff_id IS NOT NULL THEN
    -- G1: 指名スタッフが当該施設に所属することを検証（fail-closed）。
    PERFORM 1 FROM staff_profiles WHERE id = p_staff_id AND facility_id = p_facility_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STAFF_NOT_IN_FACILITY: 指定されたスタッフはこの施設に所属していません';
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

-- CREATE は既定で PUBLIC に EXECUTE を付与するため、service_role 限定（20260704000002 と同一方針）を
-- 新シグネチャで再確立する。GRANT を先に行い service_role の実行権を保全してから REVOKE する。
GRANT EXECUTE ON FUNCTION create_booking_atomic(
  UUID, UUID, UUID, UUID, UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, BOOLEAN
) TO service_role;

REVOKE EXECUTE ON FUNCTION create_booking_atomic(
  UUID, UUID, UUID, UUID, UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. change_booking_atomic
-- ============================================================================
DROP FUNCTION IF EXISTS change_booking_atomic(
  UUID, UUID, DATE, TIME, TIME
);
DROP FUNCTION IF EXISTS change_booking_atomic(
  UUID, UUID, DATE, TIME, TIME, BOOLEAN
);

CREATE FUNCTION change_booking_atomic(
  p_booking_id UUID,
  p_user_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_enforce_schedule BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_facility_id UUID;
  v_staff_id UUID;
  v_status TEXT;
  v_owner UUID;
  v_conflict_count INT;
  v_active_staff INT;
  v_lock_key BIGINT;
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
  SELECT facility_id, staff_id, status, user_id
    INTO v_facility_id, v_staff_id, v_status, v_owner
  FROM bookings
  WHERE id = p_booking_id;

  IF v_facility_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;
  IF v_owner IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'BOOKING_FORBIDDEN';
  END IF;
  IF v_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'BOOKING_NOT_CHANGEABLE';
  END IF;

  v_lock_key := ('x' || left(md5(v_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- M-2: get_available_slots と同一のバッファを競合判定にも強制する。
  -- （スケジュールゲート用に business_hours も同じ SELECT で相乗り取得する）
  SELECT COALESCE(booking_buffer_minutes, 0), business_hours
  INTO v_buffer_minutes, v_business_hours
  FROM facility_profiles WHERE id = v_facility_id;

  -- スケジュールゲート（公開経路のみ p_enforce_schedule=TRUE で発効。get_available_slots ミラー）
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

    -- b. 指名スタッフ勤務窓ゲート（変更対象予約の担当スタッフに対して。get_available_slots と
    --    同じ優先順: schedule_overrides の当日行 → staff_schedules の当曜日行）。
    IF v_staff_id IS NOT NULL THEN
      SELECT so.is_holiday, so.start_time, so.end_time
      INTO v_gate_is_holiday, v_gate_work_start, v_gate_work_end
      FROM schedule_overrides so
      WHERE so.staff_id = v_staff_id AND so.date = p_booking_date;

      IF FOUND AND v_gate_is_holiday THEN
        RAISE EXCEPTION 'STAFF_NOT_WORKING: このスタッフはこの日は勤務していません';
      END IF;

      IF v_gate_work_start IS NULL THEN
        SELECT ss.start_time, ss.end_time
        INTO v_gate_work_start, v_gate_work_end
        FROM staff_schedules ss
        WHERE ss.staff_id = v_staff_id AND ss.day_of_week = v_gate_dow;
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
  END IF;

  IF v_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = v_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND id <> p_booking_id
      AND start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL
      AND end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = v_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid')
      AND id <> p_booking_id
      AND start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL
      AND end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time;

    -- G2: おまかせ容量は勤務中スタッフ数（get_available_slots ミラー）。
    v_dow := EXTRACT(DOW FROM p_booking_date)::int;
    SELECT COUNT(*) INTO v_active_staff
    FROM staff_profiles sp
    WHERE sp.facility_id = v_facility_id
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

  UPDATE bookings
  SET booking_date = p_booking_date,
      start_time = p_start_time,
      end_time = p_end_time,
      updated_at = NOW()
  WHERE id = p_booking_id;
END;
$$;

-- CREATE は既定で PUBLIC に EXECUTE を付与するため、service_role 限定（20260704000002 と同一方針）を
-- 新シグネチャで再確立する。GRANT を先に行い service_role の実行権を保全してから REVOKE する。
GRANT EXECUTE ON FUNCTION change_booking_atomic(
  UUID, UUID, DATE, TIME, TIME, BOOLEAN
) TO service_role;

REVOKE EXECUTE ON FUNCTION change_booking_atomic(
  UUID, UUID, DATE, TIME, TIME, BOOLEAN
) FROM PUBLIC, anon, authenticated;

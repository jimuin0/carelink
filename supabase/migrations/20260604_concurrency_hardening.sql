-- 並行性ハードニング（round4 監査 #H/#J）
--
-- 依存: 20260603_booking_gates.sql / 20260604_facility_status_gate.sql / 20260603_reorder_rpcs.sql 適用済み。
-- いずれも CREATE OR REPLACE による既存関数の再定義（ロック追加のみ）。挙動（戻り値・例外・更新内容）は不変。

-- ========================= #H 管理予約 RPC に施設×日 advisory lock を追加 =========================
-- 公開版 create_booking_atomic は「施設×日(day-lock) → スロット(slot-lock)」の2段ロック下で
-- 日別受付上限(capacity)の COUNT→判定 を直列化している。一方、管理 手動投入/変更 RPC は
-- slot-lock のみを取得していたため、公開版が capacity 判定中（day-lock 保持中）に
-- 管理 INSERT が割り込み、公開版が読んだ件数に管理予約が含まれず上限を1件超過し得る理論窓があった。
-- 管理 RPC にも公開版と同一キーの day-lock を「slot-lock より先に」取得させ、ロック順(day→slot)を
-- 公開版と一致させる（デッドロックを増やさず capacity 判定区間を完全直列化）。

CREATE OR REPLACE FUNCTION create_admin_booking_atomic(
  p_facility_id UUID,
  p_staff_id UUID,
  p_menu_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_customer_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_note TEXT,
  p_total_price INT,
  p_source TEXT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking_id UUID;
  v_conflict_count INT;
  v_lock_key BIGINT;
  v_day_lock_key BIGINT;
BEGIN
  -- 施設×日 → スロット の順で advisory lock（公開版と同一キー・固定順でデッドロック回避）
  v_day_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_day_lock_key);
  v_lock_key := ('x' || left(md5(
    COALESCE(p_staff_id::text, p_facility_id::text)
    || p_booking_date::text
    || p_start_time::text
  ), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
  END IF;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
  END IF;

  INSERT INTO bookings (
    facility_id, staff_id, menu_id, booking_date, start_time, end_time,
    customer_name, email, phone, note, total_price, status, source
  ) VALUES (
    p_facility_id, p_staff_id, p_menu_id, p_booking_date, p_start_time, p_end_time,
    p_customer_name, p_email, p_phone, p_note, p_total_price, 'confirmed', p_source
  )
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION update_admin_booking_atomic(
  p_booking_id UUID,
  p_facility_id UUID,
  p_staff_id UUID,
  p_menu_id UUID,
  p_booking_date DATE,
  p_start_time TIME,
  p_end_time TIME,
  p_customer_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_note TEXT,
  p_total_price INT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated_id UUID;
  v_conflict_count INT;
  v_lock_key BIGINT;
  v_day_lock_key BIGINT;
BEGIN
  -- 施設×日 → スロット の順で advisory lock（公開版と同一キー・固定順）
  v_day_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_day_lock_key);
  v_lock_key := ('x' || left(md5(
    COALESCE(p_staff_id::text, p_facility_id::text)
    || p_booking_date::text
    || p_start_time::text
  ), 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF p_staff_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE staff_id = p_staff_id
      AND booking_date = p_booking_date
      AND id <> p_booking_id
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
  ELSE
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE facility_id = p_facility_id
      AND booking_date = p_booking_date
      AND id <> p_booking_id
      AND status NOT IN ('cancelled', 'no_show')
      AND start_time < p_end_time
      AND end_time > p_start_time;
  END IF;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
  END IF;

  UPDATE bookings SET
    staff_id = p_staff_id,
    menu_id = p_menu_id,
    booking_date = p_booking_date,
    start_time = p_start_time,
    end_time = p_end_time,
    customer_name = p_customer_name,
    email = p_email,
    phone = p_phone,
    note = p_note,
    total_price = p_total_price,
    updated_at = now()
  WHERE id = p_booking_id AND facility_id = p_facility_id
  RETURNING id INTO v_updated_id;

  RETURN v_updated_id;
END;
$$;

-- ========================= #J 並び替え RPC に施設×テーブル advisory lock を追加 =========================
-- 各 reorder RPC は単一トランザクションで原子的だが、同一施設へ並行 reorder が来ると
-- 行ロック解放順で「リクエスト1の一部 + リクエスト2の一部」が混在した sort_order になり得た。
-- 施設×テーブル単位の advisory lock で並行 reorder を直列化する。lock キーにテーブル識別子を
-- 含めることで3関数間のキー衝突も回避する。

CREATE OR REPLACE FUNCTION reorder_facility_photos(p_facility_id UUID, p_ids UUID[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE i INT;
BEGIN
  PERFORM pg_advisory_xact_lock(('x' || left(md5(p_facility_id::text || ':photos'), 16))::bit(64)::bigint);
  FOR i IN 1 .. array_length(p_ids, 1) LOOP
    UPDATE facility_photos SET sort_order = i - 1
    WHERE id = p_ids[i] AND facility_id = p_facility_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION reorder_coupons(p_facility_id UUID, p_ids UUID[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE i INT;
BEGIN
  PERFORM pg_advisory_xact_lock(('x' || left(md5(p_facility_id::text || ':coupons'), 16))::bit(64)::bigint);
  FOR i IN 1 .. array_length(p_ids, 1) LOOP
    UPDATE coupons SET sort_order = i - 1
    WHERE id = p_ids[i] AND facility_id = p_facility_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION reorder_facility_menus(p_facility_id UUID, p_ids UUID[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE i INT;
BEGIN
  PERFORM pg_advisory_xact_lock(('x' || left(md5(p_facility_id::text || ':menus'), 16))::bit(64)::bigint);
  FOR i IN 1 .. array_length(p_ids, 1) LOOP
    UPDATE facility_menus SET sort_order = i - 1
    WHERE id = p_ids[i] AND facility_id = p_facility_id;
  END LOOP;
END;
$$;

-- ========================= #I 注目口コミ(Pick Up)の「ちょうど1件」を原子保証 =========================
-- Pick Up 設定は「他を全て false → この1件を true」の2文で構成され、施設単位の排他が無かった。
-- 同一施設で2件の Pick Up 設定 PATCH がほぼ同時に来ると、各々の clear-others が相手を消し合い、
-- 最終状態が 0件（注目枠が消える）または瞬間2件になり得た。施設×review_pickup の advisory lock 下で
-- clear-others と set-self を単一トランザクションで実行し、並行 PATCH を直列化して常に厳密1件にする。
-- 依存: facility_reviews.is_pickup 列（20260602_*）が存在すること。
CREATE OR REPLACE FUNCTION set_review_pickup_atomic(p_review_id UUID, p_facility_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(('x' || left(md5(p_facility_id::text || ':review_pickup'), 16))::bit(64)::bigint);
  -- 同一施設の他の Pick Up を全て解除
  UPDATE facility_reviews SET is_pickup = false
    WHERE facility_id = p_facility_id AND is_pickup = true AND id <> p_review_id;
  -- この1件を Pick Up に設定（facility_id 一致を WHERE に含め IDOR 防御）
  UPDATE facility_reviews SET is_pickup = true
    WHERE id = p_review_id AND facility_id = p_facility_id;
END;
$$;

-- 来店ポイントの上限＝予約時の金額（2026年10月23日）。
-- 神原さん決定（2026年10月22日）「予約時の金額を上限にする」。
--
-- 【問題】来店ポイント（sync_booking_points・完了時の total_price の 1%）は上限なしで付与されていた。
-- 退店レジ会計（checkout_booking_with_points_atomic）は店舗が入力した明細の合計で total_price を
-- 上書きするので、店舗が金額を打ち間違えれば（または意図的に）、どの店でも使える共通ポイントが
-- 何倍にも発行された（1 行 1 億円×21 行で 2,100 万 pt）。店舗の owner / admin 本人が自店を予約して
-- 完了させても来店ポイントが付いた。
--
-- 【対処】
--  * bookings.points_base_price（新しい列・NULL 可）に、予約作成時にサーバーが計算した金額
--    （メニュー＋指名料−クーポン。ポイント利用前）を保存する。書くのは予約 RPC
--    create_booking_for_menus_atomic だけで、ログインした予約に限る（ゲスト・電話予約は NULL）。
--    p_total_price はポイント利用後の金額（/api/booking の finalPrice）なので、
--    p_total_price + p_points_used がポイント利用前の金額になる。ブラウザのロールは bookings に
--    INSERT / UPDATE 権を持たないので、この列は店舗からは書き換えられない。
--  * 来店ポイント＝floor(least(完了時の total_price, points_base_price) / 100)。
--    会計で増やした分（物販など）は対象外、減らした分はそのまま減る。
--    points_base_price が NULL の既存予約は従来どおり完了時の total_price で計算する
--    （LEAST は NULL を無視するので、会計後の金額を超えることは無い）。
--  * 予約したアカウントがその店舗の owner / admin（facility_members）なら来店ポイントを付けない
--    （完了した時点のメンバーシップで判定する）。
--  * 取消（completed → no_show）は従来どおり「実際に付与した award 行の点数」を戻す。
--    付与が 0 の予約は award 行も取消行も作らない。
--  * 付与額の式は booking_visit_points_due() の 1 か所にまとめ、トリガ・完了 RPC の再実行チェック・
--    台帳監査（booking_point_legacy_issues）が同じ式を使う。式がずれると、正しい付与が
--    POINTS_LEGACY_RECONCILIATION_REQUIRED や監査の誤報になるため。
--    再実行チェックと監査は「その時点の」メンバーシップで計算するので、完了した後に予約者が
--    その店舗の owner / admin になった（またはやめた）予約は、監査に 1 行出ることがある。
--
-- 各関数は最新の定義の写しで、変えたのは上記の箇所だけ（署名・所有者・SECURITY・search_path は
-- そのまま。REVOKE / GRANT を再記述する）:
--   create_booking_for_menus_atomic … 20261022160000_coupon_target_eligibility.sql（INSERT に 1 列）
--   sync_booking_points / complete_booking_with_points_atomic / booking_point_legacy_issues
--     … 20261008080209_atomic_booking_points.sql（以後の上書きも DO ブロックでの書き換えも無い）
--
-- 適用順序: アプリのデプロイの前後どちらでもよい。列は NULL 可の追加だけで、どの RPC も署名を
-- 変えないので旧コードはそのまま動く。データの書き換えは無い（既存の予約は NULL のまま＝従来の計算）。
-- 実 DB での検証: supabase/shadow/booking-points-cap-fixtures.sql（上限・NULL の既存予約・
-- 店舗メンバー本人の予約・取消・完了の再実行・監査・権限）。
--
-- ⚠️ この migration の範囲外: 上限は「予約時の金額」なので、店舗がメニューの価格そのものを高く
-- 設定すれば、その金額の 1% までは付与される（メニュー価格は店舗ページに公開される表示価格）。
--
-- ⚠️ 価格の無いメニューには来店ポイントが付かない（意図した結果）: /api/booking はメニュー価格（price）が
-- NULL のもの（要相談・価格未設定・保険診療で price が空のメニューなど）を 0 円として合計するので、
-- その予約の points_base_price は 0（指名料があれば指名料だけ）になり、会計でいくら払っても来店ポイントは
-- 0 になる。この変更より前は会計額の 1% が付いていた。「〜」付き（price_show_tilde）のメニューは表示価格
-- （下限）が上限になる。上限を外す（NULL にして会計額で計算する）と、店舗が会計額を打てば上限なしで
-- 発行できる元の穴に戻るため、そうはしていない。価格の無いメニューにも付けるなら、固定の上限額を設けるなど
-- 別の製品判断が要る。fixture（booking-points-cap-fixtures.sql のケース 9）と /admin/manual に明記してある。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

ALTER TABLE public.bookings ADD COLUMN points_base_price integer
  CONSTRAINT bookings_points_base_price_check CHECK (points_base_price >= 0);
COMMENT ON COLUMN public.bookings.points_base_price IS
  '来店ポイントの上限額。予約作成時にサーバーが計算した金額（メニュー＋指名料−クーポン、ポイント利用前）。ゲスト・電話予約と 2026-10-23 より前の予約は NULL（完了時の total_price で計算）。';

-- The single definition of the visit points a completed booking earns.
CREATE OR REPLACE FUNCTION public.booking_visit_points_due(p_user_id uuid, p_facility_id uuid,
  p_total_price int, p_points_base_price int)
RETURNS int LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN 0
    -- The shop's own owner / admin booking their own shop earns nothing.
    WHEN EXISTS (SELECT 1 FROM public.facility_members m
      WHERE m.facility_id = p_facility_id AND m.user_id = p_user_id AND m.role IN ('owner', 'admin')) THEN 0
    -- LEAST ignores NULL: a booking without a stored amount keeps the completed total.
    ELSE floor(GREATEST(LEAST(COALESCE(p_total_price, 0), p_points_base_price), 0) / 100.0)::int
  END;
$$;
REVOKE ALL ON FUNCTION public.booking_visit_points_due(uuid,uuid,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_visit_points_due(uuid,uuid,int,int) TO service_role;

-- Copy of 20261022160000_coupon_target_eligibility.sql; only the INSERT gains points_base_price.
CREATE OR REPLACE FUNCTION public.create_booking_for_menus_atomic(
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
  p_points_used INT,
  p_status TEXT,
  p_enforce_schedule BOOLEAN,
  p_menu_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id UUID;
  v_conflict_count INT;
  v_lock_key BIGINT;
  v_max_uses INT;
  v_redemption_count INT;
  -- Coupon target (新規／リピーター) check, see below.
  v_coupon_type TEXT;
  v_account_email TEXT;
  v_buffer_minutes INT;
  -- The staff member stored on the reservation: the named one, or the one assigned below.
  v_staff_id UUID := p_staff_id;
  v_menu_ids UUID[];
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
  PERFORM public.lock_booking_account(p_user_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:' || p_facility_id::text,0));
  v_lock_key := ('x' || left(md5(p_facility_id::text || p_booking_date::text), 16))::bit(64)::bigint;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- M-2: get_available_slots と同一のバッファを競合判定にも強制する。
  -- （スケジュールゲート用に business_hours も同じ SELECT で相乗り取得する）
  SELECT COALESCE(booking_buffer_minutes, 0), business_hours
  INTO v_buffer_minutes, v_business_hours
  FROM facility_profiles WHERE id = p_facility_id;

  -- スケジュールゲート a.（公開経路のみ p_enforce_schedule=TRUE で発効。get_available_slots ミラー）
  IF p_enforce_schedule THEN
    -- Lock the readiness inputs through the public mutation; admin manual booking is unchanged.
    PERFORM id FROM public.facility_profiles WHERE id = p_facility_id FOR SHARE;
    PERFORM id FROM public.facility_menus WHERE facility_id = p_facility_id AND is_published IS DISTINCT FROM false FOR SHARE;
    PERFORM id FROM public.facility_photos WHERE facility_id = p_facility_id FOR SHARE;
    PERFORM id FROM public.staff_profiles WHERE facility_id = p_facility_id AND is_active FOR SHARE;
    SELECT COALESCE(booking_buffer_minutes, 0), business_hours INTO v_buffer_minutes, v_business_hours
    FROM public.facility_profiles WHERE id = p_facility_id;
    PERFORM id FROM public.staff_profiles WHERE id=p_staff_id AND facility_id=p_facility_id FOR SHARE;
    PERFORM id FROM public.facility_menus WHERE id=p_menu_id AND facility_id=p_facility_id FOR SHARE;
    IF NOT public.facility_booking_ready(p_facility_id) THEN
      RAISE EXCEPTION 'BOOKING_NOT_READY: ネット予約は準備中です';
    END IF;
    IF p_staff_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.staff_profiles WHERE id=p_staff_id AND facility_id=p_facility_id AND is_active
    ) THEN RAISE EXCEPTION 'STAFF_NOT_WORKING: 指定スタッフは現在受付していません'; END IF;
    IF p_menu_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.facility_menus WHERE id=p_menu_id AND facility_id=p_facility_id AND is_published IS DISTINCT FROM false
    ) THEN RAISE EXCEPTION 'BOOKING_MENU_UNAVAILABLE: 選択メニューは現在受付していません'; END IF;
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

    -- A legacy reservation without a staff member still needs one of the working staff.
    IF public.booking_unassigned_capacity_full(p_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes, NULL) THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  ELSE
    IF public.booking_unassigned_capacity_full(p_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes, NULL) THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;

    v_menu_ids := ARRAY(
      SELECT DISTINCT chosen.id
      FROM unnest(array_append(COALESCE(p_menu_ids, ARRAY[]::uuid[]), p_menu_id)) AS chosen(id)
      WHERE chosen.id IS NOT NULL
    );

    -- おまかせ: store a concrete free staff member so that later named reservations,
    -- changes and get_available_slots see the slot as taken by that member.
    -- staff_auto_assigned (below) keeps it from reading as a nomination.
    v_staff_id := public.booking_pick_free_staff(p_facility_id, p_booking_date, p_start_time, p_end_time,
      v_buffer_minutes, v_menu_ids, NULL, NULL);

    IF v_staff_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
  END IF;

  IF p_coupon_id IS NOT NULL THEN
    SELECT max_uses, coupon_type INTO v_max_uses, v_coupon_type FROM coupons WHERE id = p_coupon_id FOR UPDATE;
    IF v_max_uses IS NOT NULL THEN
      SELECT COUNT(*) INTO v_redemption_count FROM coupon_redemptions WHERE coupon_id = p_coupon_id;
      IF v_redemption_count >= v_max_uses THEN
        RAISE EXCEPTION 'COUPON_LIMIT: このクーポンは利用上限に達しています';
      END IF;
    END IF;
  END IF;

  -- Coupon target (2026-10-22). Only the signed-in account's own history is
  -- consulted, never the e-mail typed into the form (see the header). The
  -- account's e-mail counts only once confirmed, and is canonicalised with the
  -- expression of the generated column bookings.email_canonical
  -- (20260607_email_canonical_column.sql), so earlier guest bookings under the
  -- same address, or a Gmail alias of it, are part of the account's history.
  -- The staff-schedule lock taken at the top serialises every booking of this
  -- facility, so two concurrent first bookings cannot both pass as 新規.
  -- Manual (phone) bookings never pass a coupon and are not affected.
  IF v_coupon_type IN ('new_customer', 'repeat') THEN
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'COUPON_TARGET_LOGIN_REQUIRED: このクーポンはログインしてご利用ください';
    END IF;
    SELECT CASE
        WHEN u.email IS NULL THEN NULL
        WHEN lower(split_part(u.email, '@', 2)) IN ('gmail.com', 'googlemail.com')
         AND length(regexp_replace(split_part(split_part(lower(btrim(u.email)), '@', 1), '+', 1), '\.', '', 'g')) > 0
        THEN regexp_replace(split_part(split_part(lower(btrim(u.email)), '@', 1), '+', 1), '\.', '', 'g') || '@gmail.com'
        ELSE lower(btrim(u.email))
      END
    INTO v_account_email
    FROM auth.users u
    WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL;
    IF v_coupon_type = 'new_customer' AND EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.facility_id = p_facility_id
        AND b.status NOT IN ('cancelled', 'cancel_fee_paid')
        AND (b.user_id = p_user_id OR b.email_canonical = v_account_email)
    ) THEN
      RAISE EXCEPTION 'COUPON_NEW_CUSTOMER_ONLY: このクーポンは初めてご予約の方限定です';
    END IF;
    IF v_coupon_type = 'repeat' AND NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.facility_id = p_facility_id
        AND b.status IN ('arrived', 'completed')
        AND (b.user_id = p_user_id OR b.email_canonical = v_account_email)
    ) THEN
      RAISE EXCEPTION 'COUPON_REPEAT_ONLY: このクーポンはご来店いただいたことがある方限定です';
    END IF;
  END IF;

  INSERT INTO bookings (
    facility_id, staff_id, staff_auto_assigned, user_id, menu_id, coupon_id,
    booking_date, start_time, end_time,
    customer_name, email, phone, note,
    total_price, points_used, status, points_base_price
  ) VALUES (
    p_facility_id, v_staff_id, p_staff_id IS NULL, p_user_id, p_menu_id, p_coupon_id,
    p_booking_date, p_start_time, p_end_time,
    p_customer_name, p_email, p_phone, p_note,
    p_total_price, p_points_used, p_status,
    -- Visit points cap (20261023000100): the booking amount before points
    -- (menus + nomination fee - coupon). Only signed-in bookings earn points.
    CASE WHEN p_user_id IS NULL THEN NULL
      ELSE LEAST(GREATEST(COALESCE(p_total_price, 0), 0)::BIGINT + GREATEST(COALESCE(p_points_used, 0), 0), 2147483647)::INT END
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
REVOKE ALL ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])
  TO service_role;

-- Copy of 20261008080209_atomic_booking_points.sql; only the award amount changes.
CREATE OR REPLACE FUNCTION public.sync_booking_points() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE balance bigint; earned int; awarded int; debit int;
BEGIN
  IF coalesce(NEW.points_used,0)<0 THEN RAISE EXCEPTION 'INVALID_BOOKING_POINTS'; END IF;
  IF NEW.user_id IS NULL THEN
    IF coalesce(NEW.points_used,0)>0 THEN RAISE EXCEPTION 'POINTS_AUTH_REQUIRED'; END IF;
    RETURN NEW;
  END IF;
  PERFORM public.lock_booking_account(NEW.user_id);
  IF TG_OP='INSERT' AND coalesce(NEW.points_used,0)>0 THEN
    SELECT coalesce(sum(points),0) INTO balance FROM public.user_points WHERE user_id=NEW.user_id;
    IF balance<NEW.points_used THEN RAISE EXCEPTION 'POINTS_INSUFFICIENT'; END IF;
    INSERT INTO public.user_points(user_id,points,reason,booking_id,booking_operation)
      VALUES(NEW.user_id,-NEW.points_used,'予約利用 ('||left(NEW.id::text,8)||')',NEW.id,'debit');
  END IF;
  IF NEW.status='completed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    -- Capped at the booking-time amount; nothing for the shop's own owner / admin (20261023000100).
    earned:=public.booking_visit_points_due(NEW.user_id,NEW.facility_id,NEW.total_price,NEW.points_base_price);
    IF earned>0 THEN
      -- Unclassified legacy booking rows require reconciliation, not guesswork.
      IF EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=NEW.id AND booking_operation IS NULL)
        THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
      INSERT INTO public.user_points(user_id,points,reason,booking_id,booking_operation)
        VALUES(NEW.user_id,earned,'来店ポイント',NEW.id,'award');
    END IF;
  ELSIF TG_OP='UPDATE' AND OLD.status='completed' AND NEW.status IS DISTINCT FROM 'completed' THEN
    SELECT points INTO awarded FROM public.user_points
      WHERE booking_id=NEW.id AND user_id=NEW.user_id AND booking_operation='award';
    IF EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=NEW.id AND booking_operation IS NULL)
      THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
    IF coalesce(awarded,0)>0 THEN
      INSERT INTO public.user_points(user_id,points,reason,booking_id,booking_operation)
        VALUES(NEW.user_id,-awarded,'来店ポイント取消',NEW.id,'reversal');
    END IF;
  END IF;
  IF NEW.status='cancelled' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'cancelled')
    AND coalesce(NEW.points_used,0)>0 THEN
    SELECT -points INTO debit FROM public.user_points
      WHERE booking_id=NEW.id AND user_id=NEW.user_id AND booking_operation='debit';
    IF debit IS DISTINCT FROM NEW.points_used
      THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
    -- An exact historical refund is already fulfilled; never credit it twice.
    IF NOT EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=NEW.id AND booking_operation='refund') THEN
      INSERT INTO public.user_points(user_id,points,reason,booking_id,booking_operation)
        VALUES(NEW.user_id,NEW.points_used,'キャンセル返還',NEW.id,'refund');
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_booking_points() FROM PUBLIC,anon,authenticated,service_role;

-- Copy of 20261008080209_atomic_booking_points.sql; only the replayed award check changes.
CREATE OR REPLACE FUNCTION public.complete_booking_with_points_atomic(p_actor_id uuid,p_booking_id uuid,p_expected_status text)
RETURNS TABLE(id uuid,points_earned int,replayed boolean) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; uid uuid; fid uuid;
BEGIN
  SELECT user_id,facility_id INTO uid,fid FROM public.bookings WHERE bookings.id=p_booking_id;
  PERFORM public.lock_booking_point_actors(p_actor_id,uid);
  PERFORM 1 FROM public.facility_profiles WHERE facility_profiles.id=fid FOR KEY SHARE;
  PERFORM 1 FROM public.facility_members WHERE facility_id=fid AND user_id=p_actor_id
    AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_booking_id AND facility_id=fid FOR UPDATE;
  IF NOT FOUND OR b.user_id IS DISTINCT FROM uid THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  IF b.status='completed' AND p_expected_status='confirmed' THEN
    IF coalesce((SELECT p.points FROM public.user_points p WHERE p.booking_id=b.id AND p.booking_operation='award'),0)
      IS DISTINCT FROM public.booking_visit_points_due(b.user_id,b.facility_id,b.total_price,b.points_base_price)
      THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.customer_visits v WHERE v.booking_id=b.id AND v.facility_id=b.facility_id
      AND v.amount IS NOT DISTINCT FROM b.total_price) THEN RAISE EXCEPTION 'BOOKING_VISIT_RECONCILIATION_REQUIRED'; END IF;
    RETURN QUERY SELECT b.id,coalesce((SELECT p.points FROM public.user_points p WHERE p.booking_id=b.id AND p.booking_operation='award'),0),true;
    RETURN;
  END IF;
  IF b.status IS DISTINCT FROM p_expected_status OR b.status<>'confirmed' THEN RAISE EXCEPTION 'BOOKING_REVISION_CONFLICT'; END IF;
  UPDATE public.bookings SET status='completed',updated_at=clock_timestamp() WHERE bookings.id=b.id;
  RETURN QUERY SELECT b.id,coalesce((SELECT p.points FROM public.user_points p WHERE p.booking_id=b.id
    AND p.booking_operation='award'),0),false;
END $$;
REVOKE ALL ON FUNCTION public.complete_booking_with_points_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_booking_with_points_atomic(uuid,uuid,text) TO service_role;

-- Copy of 20261008080209_atomic_booking_points.sql; only the expected award changes.
CREATE OR REPLACE FUNCTION public.booking_point_legacy_issues()
RETURNS TABLE(booking_id uuid,issue text) LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT b.id,'missing_or_ambiguous_debit'::text FROM public.bookings b
  WHERE b.points_used>0 AND NOT EXISTS(SELECT 1 FROM public.user_points p
    WHERE p.booking_id=b.id AND p.user_id=b.user_id AND p.booking_operation='debit' AND p.points=-b.points_used)
  UNION ALL
  SELECT p.booking_id,'unclassified_booking_entry' FROM public.user_points p
    WHERE p.booking_id IS NOT NULL AND p.booking_operation IS NULL
  UNION ALL
  SELECT b.id,'missing_or_mismatched_completion_award' FROM public.bookings b
    WHERE b.user_id IS NOT NULL AND b.status='completed'
      AND public.booking_visit_points_due(b.user_id,b.facility_id,b.total_price,b.points_base_price)>0
      AND NOT EXISTS(SELECT 1 FROM public.user_points p WHERE p.booking_id=b.id AND p.user_id=b.user_id
        AND p.booking_operation='award'
        AND p.points=public.booking_visit_points_due(b.user_id,b.facility_id,b.total_price,b.points_base_price))
  UNION ALL
  SELECT b.id,'missing_refund' FROM public.bookings b
    WHERE b.user_id IS NOT NULL AND b.status='cancelled' AND b.points_used>0
      AND EXISTS(SELECT 1 FROM public.user_points p WHERE p.booking_id=b.id AND p.booking_operation='debit' AND p.points=-b.points_used)
      AND NOT EXISTS(SELECT 1 FROM public.user_points p WHERE p.booking_id=b.id AND p.booking_operation='refund' AND p.points=b.points_used)
  UNION ALL
  SELECT b.id,'missing_completion_reversal' FROM public.bookings b JOIN public.user_points a
    ON a.booking_id=b.id AND a.booking_operation='award'
    WHERE b.status<>'completed' AND NOT EXISTS(SELECT 1 FROM public.user_points r
      WHERE r.booking_id=b.id AND r.booking_operation='reversal' AND r.points=-a.points);
$$;
REVOKE ALL ON FUNCTION public.booking_point_legacy_issues() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.booking_point_legacy_issues() TO service_role;

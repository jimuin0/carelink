-- Keep point accounting and booking state/data in the same PostgreSQL transaction.
-- The API uses this wrapper instead of committing create_booking_atomic and then
-- attempting independent point/menu writes that could fail after the booking exists.

-- Store one opaque idempotency token on the created booking. The token is not
-- authorization; booking access remains governed by existing RLS and server auth.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS idempotency_key UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_idempotency_key_unique
  ON public.bookings(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- A booking can have one debit and one credit (refund or completion award).
-- Keep those transactions individually attributable without allowing duplicate
-- debits or duplicate credits for the same booking.
DROP INDEX IF EXISTS public.idx_user_points_booking_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_points_booking_debit_unique
  ON public.user_points(booking_id)
  WHERE booking_id IS NOT NULL AND points < 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_points_booking_credit_unique
  ON public.user_points(booking_id)
  WHERE booking_id IS NOT NULL AND points > 0;

CREATE OR REPLACE FUNCTION public.deduct_booking_points_atomic(
  p_user_id UUID,
  p_points INT,
  p_reason TEXT,
  p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance INT;
  v_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_booking_id IS NULL OR p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'INVALID_POINTS_REQUEST';
  END IF;

  PERFORM 1
    FROM public.bookings
   WHERE id = p_booking_id
     AND user_id = p_user_id
     AND points_used = p_points
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_POINTS_MISMATCH';
  END IF;

  PERFORM 1 FROM public.user_points WHERE user_id = p_user_id FOR UPDATE;
  SELECT COALESCE(SUM(points), 0) INTO v_balance
    FROM public.user_points
   WHERE user_id = p_user_id;

  IF v_balance < p_points THEN
    RAISE EXCEPTION 'INSUFFICIENT_POINTS';
  END IF;

  INSERT INTO public.user_points(user_id, points, reason, booking_id)
  VALUES (p_user_id, -p_points, p_reason, p_booking_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('deduction_id', v_id, 'balance', v_balance - p_points);
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_booking_points_atomic(UUID, INT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_booking_points_atomic(UUID, INT, TEXT, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_booking_with_points_atomic(
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
  p_idempotency_key UUID,
  p_points_used INT DEFAULT 0,
  p_status TEXT DEFAULT 'pending',
  p_enforce_schedule BOOLEAN DEFAULT FALSE,
  p_menu_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id UUID;
  v_existing_booking public.bookings%ROWTYPE;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  IF p_points_used IS NOT NULL AND p_points_used < 0 THEN
    RAISE EXCEPTION 'INVALID_POINTS_REQUEST';
  END IF;

  -- Serialize identical request tokens. A retry waits for the first transaction,
  -- then receives its committed booking instead of consuming capacity/points again.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT *
    INTO v_existing_booking
    FROM public.bookings
   WHERE idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing_booking.user_id IS DISTINCT FROM p_user_id
       OR v_existing_booking.facility_id IS DISTINCT FROM p_facility_id
       OR v_existing_booking.staff_id IS DISTINCT FROM p_staff_id
       OR v_existing_booking.menu_id IS DISTINCT FROM p_menu_id
       OR v_existing_booking.coupon_id IS DISTINCT FROM p_coupon_id
       OR v_existing_booking.booking_date IS DISTINCT FROM p_booking_date
       OR v_existing_booking.start_time IS DISTINCT FROM p_start_time
       OR v_existing_booking.end_time IS DISTINCT FROM p_end_time
       OR v_existing_booking.customer_name IS DISTINCT FROM p_customer_name
       OR v_existing_booking.email IS DISTINCT FROM p_email
       OR v_existing_booking.phone IS DISTINCT FROM p_phone
       OR v_existing_booking.note IS DISTINCT FROM p_note
       OR v_existing_booking.total_price IS DISTINCT FROM p_total_price
       OR COALESCE(v_existing_booking.points_used, 0) IS DISTINCT FROM COALESCE(p_points_used, 0)
       OR v_existing_booking.menu_ids IS DISTINCT FROM CASE
         WHEN p_menu_ids IS NOT NULL AND cardinality(p_menu_ids) > 1 THEN p_menu_ids
         ELSE NULL
       END THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED';
    END IF;
    RETURN jsonb_build_object('booking_id', v_existing_booking.id, 'replayed', true);
  END IF;

  v_booking_id := public.create_booking_atomic(
    p_facility_id,
    p_staff_id,
    p_user_id,
    p_menu_id,
    p_coupon_id,
    p_booking_date,
    p_start_time,
    p_end_time,
    p_customer_name,
    p_email,
    p_phone,
    p_note,
    p_total_price,
    COALESCE(p_points_used, 0),
    p_status,
    p_enforce_schedule
  );

  IF COALESCE(p_points_used, 0) > 0 THEN
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_POINTS_REQUEST';
    END IF;

    -- deduct_booking_points_atomic locks the user's ledger, checks the authoritative
    -- balance, and inserts the debit. Any error aborts this entire wrapper,
    -- including the booking and coupon redemption inserted above.
    PERFORM public.deduct_booking_points_atomic(
      p_user_id,
      p_points_used,
      format('予約利用 (%s)', left(v_booking_id::text, 8)),
      v_booking_id
    );
  END IF;

  IF p_menu_ids IS NOT NULL AND cardinality(p_menu_ids) > 1 THEN
    UPDATE public.bookings
       SET menu_ids = p_menu_ids
     WHERE id = v_booking_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOOKING_MENU_IDS_PERSIST_FAILED';
    END IF;
  END IF;

  UPDATE public.bookings
     SET idempotency_key = p_idempotency_key
   WHERE id = v_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_IDEMPOTENCY_PERSIST_FAILED';
  END IF;

  RETURN jsonb_build_object('booking_id', v_booking_id, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking_with_points_atomic(
  UUID, UUID, UUID, UUID, UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT,
  INT, UUID, INT, TEXT, BOOLEAN, UUID[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_with_points_atomic(
  UUID, UUID, UUID, UUID, UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT,
  INT, UUID, INT, TEXT, BOOLEAN, UUID[]
) TO service_role;

-- Cancellation state transition and point refund are also one transaction.
-- If the ledger insert fails, PostgreSQL rolls back the status update so that
-- the customer can safely retry without losing points or receiving a duplicate.
CREATE OR REPLACE FUNCTION public.cancel_booking_with_points_atomic(
  p_booking_id UUID,
  p_facility_id UUID,
  p_user_id UUID,
  p_expected_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_points_used INT;
  v_user_id UUID;
BEGIN
  IF p_booking_id IS NULL OR p_facility_id IS NULL
     OR p_expected_status NOT IN ('pending', 'confirmed', 'arrived', 'no_show') THEN
    RAISE EXCEPTION 'INVALID_CANCELLATION_REQUEST';
  END IF;

  UPDATE public.bookings
     SET status = 'cancelled', updated_at = now()
   WHERE id = p_booking_id
     AND facility_id = p_facility_id
     AND user_id IS NOT DISTINCT FROM p_user_id
     AND status = p_expected_status
   RETURNING points_used, user_id INTO v_points_used, v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('cancelled', false);
  END IF;

  -- Defensive idempotent cleanup for legacy rows on no_show -> cancelled. The
  -- completed -> no_show transition now removes these atomically; this also repairs
  -- any stale visit/award left by an earlier partial failure. Never delete booking-
  -- use debits or cancellation credits: they share booking_id but are separate
  -- ledger transaction types.
  DELETE FROM public.customer_visits WHERE booking_id = p_booking_id;
  DELETE FROM public.user_points
   WHERE booking_id = p_booking_id
     AND reason = '来店ポイント';

  IF COALESCE(v_points_used, 0) > 0 THEN
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_POINTS_OWNER_MISSING';
    END IF;

    INSERT INTO public.user_points(user_id, points, reason, booking_id)
    VALUES (v_user_id, v_points_used, 'キャンセル返還', p_booking_id);
  END IF;

  RETURN jsonb_build_object(
    'cancelled', true,
    'booking_id', p_booking_id,
    'points_refunded', COALESCE(v_points_used, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_booking_with_points_atomic(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_with_points_atomic(UUID, UUID, UUID, TEXT)
  TO service_role;

-- Correcting a completed booking to no_show must remove its visit and earned
-- points in the same transaction as the status CAS. A partial failure must leave
-- the booking completed so a retry cannot expose stale rewards as spendable.
CREATE OR REPLACE FUNCTION public.mark_booking_no_show_atomic(
  p_booking_id UUID,
  p_facility_id UUID,
  p_expected_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_booking_id UUID;
BEGIN
  IF p_booking_id IS NULL OR p_facility_id IS NULL
     OR p_expected_status NOT IN ('confirmed', 'arrived', 'completed') THEN
    RAISE EXCEPTION 'INVALID_NO_SHOW_REQUEST';
  END IF;

  UPDATE public.bookings
     SET status = 'no_show', updated_at = now()
   WHERE id = p_booking_id
     AND facility_id = p_facility_id
     AND status = p_expected_status
   RETURNING id INTO v_updated_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false);
  END IF;

  DELETE FROM public.customer_visits WHERE booking_id = v_updated_booking_id;
  DELETE FROM public.user_points
   WHERE booking_id = v_updated_booking_id
     AND reason = '来店ポイント';

  RETURN jsonb_build_object('updated', true, 'booking_id', v_updated_booking_id);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_booking_no_show_atomic(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_booking_no_show_atomic(UUID, UUID, TEXT)
  TO service_role;

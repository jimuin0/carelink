-- Remove the production-only RPC public.deduct_points_atomic(uuid, integer, text).
--
-- It was created by 20260919000003_atomic_points_booking.sql, which was replaced
-- the same day by 20260920000001_booking_points_transactions_atomic.sql (points
-- now move inside the booking create/cancel/checkout transactions). The file was
-- removed from the repository but the function stayed in production, so the
-- nightly schema-drift-check has reported it as driftExtra every night
-- (warningCount 2: the function and its service_role grant).
--
-- Verified 2026-10-21 before dropping: no application code calls it (only the
-- generated type entry, removed in the same change), no other function in
-- public/auth/storage references it, no trigger uses it, and only postgres and
-- service_role can execute it. Dropping it removes a SECURITY DEFINER path that
-- writes user_points outside the booking transactions.
--
-- Original definition, kept here so the drop can be reversed if ever needed:
--   CREATE OR REPLACE FUNCTION public.deduct_points_atomic(p_user_id uuid, p_points integer, p_reason text)
--    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--   DECLARE v_balance INT; v_id UUID;
--   BEGIN
--     IF p_user_id IS NULL OR p_points IS NULL OR p_points <= 0 THEN RAISE EXCEPTION 'INVALID_POINTS_REQUEST'; END IF;
--     PERFORM 1 FROM public.user_points WHERE user_id = p_user_id FOR UPDATE;
--     SELECT COALESCE(SUM(points), 0) INTO v_balance FROM public.user_points WHERE user_id = p_user_id;
--     IF v_balance < p_points THEN RAISE EXCEPTION 'INSUFFICIENT_POINTS'; END IF;
--     INSERT INTO public.user_points(user_id, points, reason) VALUES (p_user_id, -p_points, p_reason) RETURNING id INTO v_id;
--     RETURN jsonb_build_object('deduction_id', v_id, 'balance', v_balance - p_points);
--   END;
--   $function$;
--   (EXECUTE was granted to service_role only.)
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.deduct_points_atomic(uuid, integer, text);

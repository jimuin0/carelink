-- Immediately after all migrations. Never delete or rewrite an ambiguous movement.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database()<>'carelink_shadow' THEN RAISE EXCEPTION 'fresh isolated shadow DB required'; END IF; END $$;
BEGIN;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.user_points WHERE user_id='fc310000-0000-4000-8000-000000000001')<>9
  OR (SELECT sum(points) FROM public.user_points WHERE user_id='fc310000-0000-4000-8000-000000000001')<>9680 THEN RAISE EXCEPTION 'cutover changed ledger value/history'; END IF;
 IF (SELECT count(*) FROM public.user_points WHERE user_id='fc310000-0000-4000-8000-000000000001' AND booking_operation='debit')<>2
  OR NOT EXISTS(SELECT 1 FROM public.user_points WHERE id='fc340000-0000-4000-8000-000000000003' AND booking_operation='award')
  OR NOT EXISTS(SELECT 1 FROM public.user_points WHERE id='fc340000-0000-4000-8000-000000000005' AND booking_operation='refund') THEN RAISE EXCEPTION 'exact legacy movements not classified'; END IF;
 IF (SELECT count(*) FROM public.user_points WHERE id IN('fc340000-0000-4000-8000-000000000006','fc340000-0000-4000-8000-000000000007','fc340000-0000-4000-8000-000000000008') AND booking_id IS NULL AND booking_operation IS NULL)<>3
  THEN RAISE EXCEPTION 'ambiguous debit guessed'; END IF;
 IF (SELECT count(*) FROM public.booking_point_legacy_issues() WHERE booking_id::text LIKE 'fc330%')<>6 THEN RAISE EXCEPTION 'legacy issue audit missed uncertainty'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.cancel_booking_with_points_atomic('fc310000-0000-4000-8000-000000000001','fc330004-0000-4000-8000-000000000001','confirmed'); RAISE EXCEPTION 'ambiguous refund accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'POINTS_LEGACY_RECONCILIATION_REQUIRED' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DELETE FROM public.bookings WHERE facility_id='fc320000-0000-4000-8000-000000000001';
DELETE FROM public.customer_visits WHERE facility_id='fc320000-0000-4000-8000-000000000001';
DELETE FROM public.facility_profiles WHERE id='fc320000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id='fc310000-0000-4000-8000-000000000001';
COMMIT;

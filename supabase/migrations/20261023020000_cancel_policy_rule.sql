-- Cancellation policy: the shop chooses one of three distinct rules, and the
-- shop is told the fee the customer was told.
--
-- Before, the /admin/settings option 「キャンセル不可」 saved free_cancel_hours=0.
-- The booking screen described that as "a fee always applies", the fee
-- calculation read it as "free until the start" (fee 0 for every online
-- cancellation, because cancellation after the start is refused), and the
-- cancel RPC never looked at the policy, so customers could cancel online.
-- 神原さん (2026-10-22): 「店舗側の設定に任せる」.
--
-- 1. facility_cancel_policies.cancel_rule (nullable, additive):
--      free_window  free until free_cancel_hours before the start, then late_cancel_rate
--      always_fee   cancellation accepted, late_cancel_rate always applies
--      no_online    customers cannot cancel from My Page / LINE; they contact the shop
--    NULL = a row saved before this migration; the application reads it from
--    free_cancel_hours (src/lib/cancel-fee.ts resolveCancelPolicy). Production has
--    0 rows, so no data is rewritten.
-- 2. cancel_booking_with_points_atomic refuses with BOOKING_ONLINE_CANCEL_DISABLED
--    when the shop chose no_online. The policy row is locked FOR SHARE so the rule
--    checked here is the rule frozen into the email snapshot below.
-- 3. The cancellation/change email snapshot (cancelPolicy) and the fee context carry
--    cancel_rule. The worker's schema strips unknown keys, so the deployed worker
--    keeps working before the new application is deployed.
-- 4. bookings.cancel_fee_context (nullable, additive) keeps the fee context of a
--    customer cancellation (the exact inputs of the emailed fee) so the admin
--    booking detail can show the shop the same amount. Written by
--    cancel_customer_booking_with_channels_atomic without touching updated_at.
--
-- Safe before the application deploy: no row has cancel_rule='no_online' until the
-- new settings screen saves one, and the old application never reads the new columns.
-- Apply this migration BEFORE deploying the application (the new settings screen and
-- booking pages read and write cancel_rule).
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

ALTER TABLE public.facility_cancel_policies
  ADD COLUMN cancel_rule text
  CONSTRAINT facility_cancel_policies_cancel_rule_check
  CHECK (cancel_rule IN ('free_window', 'always_fee', 'no_online'));
COMMENT ON COLUMN public.facility_cancel_policies.cancel_rule IS
  'free_window | always_fee | no_online. NULL: saved before 20261023020000, read from free_cancel_hours (src/lib/cancel-fee.ts).';

ALTER TABLE public.bookings ADD COLUMN cancel_fee_context jsonb;
COMMENT ON COLUMN public.bookings.cancel_fee_context IS
  'Fee inputs of a customer cancellation (policy, totalPrice, bookingDate, startTime, capturedAt), identical to the emailed fee.';

-- Authoritative body: 20261008080209 + the online cancellation rule.
CREATE OR REPLACE FUNCTION public.cancel_booking_with_points_atomic(p_actor_id uuid,p_booking_id uuid,p_expected_status text)
RETURNS TABLE(id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; fid uuid; rule text;
BEGIN
  PERFORM public.lock_booking_account(p_actor_id);
  SELECT facility_id INTO fid FROM public.bookings WHERE bookings.id=p_booking_id AND user_id=p_actor_id;
  PERFORM 1 FROM public.facility_profiles WHERE facility_profiles.id=fid FOR KEY SHARE;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_booking_id AND user_id=p_actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  IF b.status IS DISTINCT FROM p_expected_status OR b.status NOT IN ('pending','confirmed','arrived')
    THEN RAISE EXCEPTION 'BOOKING_REVISION_CONFLICT'; END IF;
  IF (b.booking_date+b.start_time) AT TIME ZONE 'Asia/Tokyo'<clock_timestamp()
    THEN RAISE EXCEPTION 'BOOKING_ALREADY_STARTED'; END IF;
  -- The shop's choice. FOR SHARE keeps the rule fixed until this transaction has
  -- frozen it into the email snapshot (a concurrent settings save waits).
  SELECT p.cancel_rule INTO rule FROM public.facility_cancel_policies p
    WHERE p.facility_id=b.facility_id FOR SHARE;
  IF rule='no_online' THEN RAISE EXCEPTION 'BOOKING_ONLINE_CANCEL_DISABLED'; END IF;
  UPDATE public.bookings SET status='cancelled',updated_at=clock_timestamp() WHERE bookings.id=b.id;
  RETURN QUERY SELECT b.id;
END $$;
REVOKE ALL ON FUNCTION public.cancel_booking_with_points_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_with_points_atomic(uuid,uuid,text) TO service_role;

-- Authoritative body: 20261022100100 + cancel_rule in the policy snapshot.
CREATE OR REPLACE FUNCTION public.publish_customer_booking_transition_email(p_booking_id uuid,p_kind text,
  p_previous_date date,p_previous_start time,p_previous_end time)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; f public.facility_profiles%ROWTYPE; menu_name text;
  snapshot jsonb; policy jsonb; recipient record; operation_id uuid; queued integer:=0; affected integer;
  has_previous boolean;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('cancelled','rescheduled')
    OR public.webhook_dispatch_v2_version()<>1 THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_CAPABILITY_UNAVAILABLE'; END IF;
  has_previous:=num_nonnulls(p_previous_date,p_previous_start,p_previous_end)=3;
  IF num_nonnulls(p_previous_date,p_previous_start,p_previous_end) NOT IN (0,3)
    OR (p_kind='cancelled' AND has_previous) THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_INVALID'; END IF;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=p_booking_id;
  IF NOT FOUND OR (p_kind='cancelled' AND b.status<>'cancelled')
    OR (p_kind='rescheduled' AND b.status NOT IN ('pending','confirmed')) THEN
    RAISE EXCEPTION 'BOOKING_NOTIFICATION_STATE_MISMATCH';
  END IF;
  SELECT * INTO f FROM public.facility_profiles WHERE facility_profiles.id=b.facility_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_FACILITY_UNAVAILABLE'; END IF;
  SELECT m.name INTO menu_name FROM public.facility_menus m WHERE m.id=b.menu_id AND m.facility_id=b.facility_id;
  SELECT jsonb_build_object('free_cancel_hours',p.free_cancel_hours,'late_cancel_rate',p.late_cancel_rate,
      'cancel_rule',p.cancel_rule)
    INTO policy FROM public.facility_cancel_policies p WHERE p.facility_id=b.facility_id;
  snapshot:=jsonb_build_object('bookingId',b.id,'bookingRevision',coalesce(b.updated_at,b.created_at),
    'customerName',b.customer_name,'customerEmail',coalesce(b.email,''),'facilityName',f.name,
    'bookingDate',b.booking_date,'startTime',b.start_time,'endTime',b.end_time,'menuName',menu_name,
    'totalPrice',b.total_price,'capturedAt',clock_timestamp(),'cancelPolicy',policy);
  IF has_previous THEN
    snapshot:=snapshot||jsonb_build_object('previous',jsonb_build_object(
      'bookingDate',p_previous_date,'startTime',p_previous_start,'endTime',p_previous_end));
  END IF;
  -- SQL scans the complete recipient set; shared owner addresses are deduplicated.
  -- A customer who also owns the shop receives the two distinct templates.
  FOR recipient IN
    SELECT 'customer'::text AS role,b.email AS email WHERE nullif(btrim(b.email),'') IS NOT NULL
    UNION ALL
    SELECT DISTINCT 'owner'::text,p.email FROM public.facility_members m JOIN public.profiles p ON p.id=m.user_id
      WHERE (p_kind='cancelled' OR has_previous) AND m.facility_id=b.facility_id AND m.role IN ('owner','admin')
        AND nullif(btrim(p.email),'') IS NOT NULL
  LOOP
    operation_id:=gen_random_uuid();
    INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload,status,scheduled_at)
      VALUES(operation_id,'email',recipient.email,b.facility_id,jsonb_build_object(
        'event_email_version',1,'dispatch_version',2,'idempotency_key','carelink-event-email/'||operation_id::text,
        'customer_booking_transition_version',1,'kind',p_kind,'role',recipient.role,'snapshot',snapshot),'pending',now())
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS affected=ROW_COUNT; queued:=queued+affected;
  END LOOP;
  RETURN queued;
END $$;
REVOKE ALL ON FUNCTION public.publish_customer_booking_transition_email(uuid,text,date,time,time) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_customer_booking_transition_email(uuid,text,date,time,time) TO service_role;

-- Authoritative body: 20261013230222 + cancel_rule in the no-email fallback and the
-- fee context kept on the booking (no updated_at change: the snapshot revision and
-- every queued delivery identity stay as they are).
CREATE OR REPLACE FUNCTION public.cancel_customer_booking_with_channels_atomic(p_actor_id uuid,p_booking_id uuid,p_expected_status text)
RETURNS TABLE(id uuid,fee_context jsonb) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; snapshot jsonb; policy jsonb; ctx jsonb;
BEGIN
  PERFORM public.cancel_customer_booking_with_outbox_atomic(p_actor_id,p_booking_id,p_expected_status);
  PERFORM public.publish_customer_booking_channels(p_booking_id,'cancelled');
  SELECT * INTO STRICT b FROM public.bookings WHERE bookings.id=p_booking_id;
  SELECT q.payload->'snapshot' INTO snapshot FROM public.webhook_retry_queue q
    WHERE q.payload->>'customer_booking_transition_version'='1' AND q.payload->>'kind'='cancelled'
      AND q.payload->'snapshot'->>'bookingId'=p_booking_id::text
      AND (q.payload->'snapshot'->>'bookingRevision')::timestamptz=coalesce(b.updated_at,b.created_at)
    ORDER BY q.id LIMIT 1;
  IF snapshot IS NOT NULL THEN
    ctx:=jsonb_build_object('policy',snapshot->'cancelPolicy',
      'totalPrice',snapshot->'totalPrice','bookingDate',snapshot->'bookingDate',
      'startTime',snapshot->'startTime','capturedAt',snapshot->'capturedAt');
  ELSE
    -- No customer/owner email addresses means there is no emailed fee to match.
    -- A failed read still rolls back the booking and every notification intent.
    SELECT jsonb_build_object('free_cancel_hours',p.free_cancel_hours,'late_cancel_rate',p.late_cancel_rate,
        'cancel_rule',p.cancel_rule)
      INTO policy FROM public.facility_cancel_policies p WHERE p.facility_id=b.facility_id;
    ctx:=jsonb_build_object('policy',policy,'totalPrice',b.total_price,
      'bookingDate',b.booking_date,'startTime',b.start_time,'capturedAt',clock_timestamp());
  END IF;
  UPDATE public.bookings SET cancel_fee_context=ctx WHERE bookings.id=p_booking_id;
  RETURN QUERY SELECT p_booking_id,ctx;
END $$;
REVOKE ALL ON FUNCTION public.cancel_customer_booking_with_channels_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_customer_booking_with_channels_atomic(uuid,uuid,text) TO service_role;

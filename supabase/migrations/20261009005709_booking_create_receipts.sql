CREATE TABLE public.booking_create_operations (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_was_authenticated boolean NOT NULL,
  guest_scope_hash text,
  facility_id uuid REFERENCES public.facility_profiles(id) ON DELETE RESTRICT,
  payload_hash text,
  state text NOT NULL CHECK(state IN ('prepared','committed','closed')),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((actor_was_authenticated AND guest_scope_hash IS NULL)
    OR (NOT actor_was_authenticated AND actor_user_id IS NULL AND guest_scope_hash IS NOT NULL AND guest_scope_hash ~ '^[a-f0-9]{64}$')),
  CHECK (payload_hash IS NULL OR payload_hash ~ '^[a-f0-9]{64}$'),
  CHECK ((state='closed') OR (payload_hash IS NOT NULL AND facility_id IS NOT NULL)),
  CHECK ((state='committed' AND response_payload IS NOT NULL) OR (state<>'committed' AND response_payload IS NULL))
);
ALTER TABLE public.booking_create_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_create_operations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.booking_create_operations TO service_role;

CREATE FUNCTION public.lock_booking_create_scope(p_id uuid,p_actor_id uuid,p_guest_hash text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_id IS NULL OR (p_actor_id IS NULL AND (p_guest_hash IS NULL OR p_guest_hash !~ '^[a-f0-9]{64}$'))
    OR (p_actor_id IS NOT NULL AND p_guest_hash IS NOT NULL) THEN RAISE EXCEPTION 'BOOKING_CREATE_SCOPE_INVALID'; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('carelink-booking-create:'||p_id::text,0));
END $$;
REVOKE ALL ON FUNCTION public.lock_booking_create_scope(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_booking_create_scope(uuid,uuid,text) TO service_role;

CREATE FUNCTION public.prepare_booking_create_operation(p_id uuid,p_actor_id uuid,p_guest_hash text,p_facility_id uuid,p_payload_hash text)
RETURNS TABLE(state text,response_payload jsonb) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE prior public.booking_create_operations%ROWTYPE;
BEGIN
  PERFORM public.lock_booking_create_scope(p_id,p_actor_id,p_guest_hash);
  IF p_facility_id IS NULL OR p_payload_hash IS NULL OR p_payload_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'BOOKING_CREATE_INPUT_INVALID'; END IF;
  SELECT o.* INTO prior FROM public.booking_create_operations o WHERE o.id=p_id FOR NO KEY UPDATE;
  IF FOUND THEN
    IF prior.actor_was_authenticated IS DISTINCT FROM (p_actor_id IS NOT NULL)
      OR prior.actor_user_id IS DISTINCT FROM p_actor_id OR prior.guest_scope_hash IS DISTINCT FROM p_guest_hash
      THEN RAISE EXCEPTION 'BOOKING_CREATE_SCOPE_CONFLICT'; END IF;
    IF prior.state='closed' THEN RAISE EXCEPTION 'BOOKING_CREATE_CLOSED'; END IF;
    IF prior.facility_id IS DISTINCT FROM p_facility_id OR prior.payload_hash IS DISTINCT FROM p_payload_hash
      THEN RAISE EXCEPTION 'BOOKING_CREATE_PAYLOAD_CONFLICT'; END IF;
    RETURN QUERY SELECT prior.state,prior.response_payload; RETURN;
  END IF;
  PERFORM f.id FROM public.facility_profiles f WHERE f.id=p_facility_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_READY'; END IF;
  INSERT INTO public.booking_create_operations(id,actor_user_id,actor_was_authenticated,guest_scope_hash,facility_id,payload_hash,state)
    VALUES(p_id,p_actor_id,p_actor_id IS NOT NULL,p_guest_hash,p_facility_id,p_payload_hash,'prepared');
  RETURN QUERY SELECT 'prepared'::text,NULL::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.prepare_booking_create_operation(uuid,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_booking_create_operation(uuid,uuid,text,uuid,text) TO service_role;

CREATE FUNCTION public.inspect_booking_create_operation(p_id uuid,p_actor_id uuid,p_guest_hash text,p_close boolean DEFAULT false)
RETURNS TABLE(state text,response_payload jsonb) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE prior public.booking_create_operations%ROWTYPE;
BEGIN
  IF p_close IS NULL THEN RAISE EXCEPTION 'BOOKING_CREATE_INPUT_INVALID'; END IF;
  PERFORM public.lock_booking_create_scope(p_id,p_actor_id,p_guest_hash);
  SELECT o.* INTO prior FROM public.booking_create_operations o WHERE o.id=p_id FOR NO KEY UPDATE;
  IF FOUND THEN
    IF prior.actor_was_authenticated IS DISTINCT FROM (p_actor_id IS NOT NULL)
      OR prior.actor_user_id IS DISTINCT FROM p_actor_id OR prior.guest_scope_hash IS DISTINCT FROM p_guest_hash
      THEN RAISE EXCEPTION 'BOOKING_CREATE_SCOPE_CONFLICT'; END IF;
    IF prior.state='committed' THEN
      IF prior.booking_id IS NULL THEN RETURN QUERY SELECT 'retired'::text,NULL::jsonb; RETURN; END IF;
      RETURN QUERY SELECT prior.state,prior.response_payload; RETURN;
    END IF;
    IF p_close AND prior.state='prepared' THEN
      UPDATE public.booking_create_operations SET state='closed' WHERE id=p_id;
      RETURN QUERY SELECT 'closed'::text,NULL::jsonb; RETURN;
    END IF;
    RETURN QUERY SELECT prior.state,NULL::jsonb; RETURN;
  END IF;
  IF p_close THEN
    -- Closing a missing key also fences a delayed prepare request. Merely
    -- observing no receipt is not proof that an older request cannot commit.
    INSERT INTO public.booking_create_operations(id,actor_user_id,actor_was_authenticated,guest_scope_hash,state)
      VALUES(p_id,p_actor_id,p_actor_id IS NOT NULL,p_guest_hash,'closed');
    RETURN QUERY SELECT 'closed'::text,NULL::jsonb; RETURN;
  END IF;
  RETURN QUERY SELECT 'missing'::text,NULL::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.inspect_booking_create_operation(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_booking_create_operation(uuid,uuid,text,boolean) TO service_role;

CREATE FUNCTION public.create_booking_with_receipt_atomic(p_id uuid,p_actor_id uuid,p_guest_hash text,p_payload_hash text,
  p_facility_id uuid,p_staff_id uuid,p_menu_id uuid,p_coupon_id uuid,p_booking_date date,p_start_time time,p_end_time time,
  p_customer_name text,p_email text,p_phone text,p_note text,p_total_price int,p_points_used int,p_status text,p_menu_ids uuid[],p_notifications jsonb)
RETURNS TABLE(response_payload jsonb,replayed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior public.booking_create_operations%ROWTYPE; b public.bookings%ROWTYPE; booking_new_id uuid; response jsonb;
  item jsonb; uid uuid; owner_ids uuid[]; target text; kind text; envelope jsonb; qid uuid; snapshot jsonb; frozen jsonb; context jsonb; actual_owners uuid[]; actual_owner_push boolean;
  expected_emails text[]; given_emails text[]; expected_push uuid[]; given_push uuid[]; expected_works text[]; given_works text[]; expected_line text; given_line text[];
BEGIN
  -- A committed receipt is replayed before stale recipient input is interpreted.
  SELECT o.* INTO prior FROM public.booking_create_operations o WHERE o.id=p_id;
  IF FOUND AND prior.state='committed' THEN
    PERFORM public.lock_booking_create_scope(p_id,p_actor_id,p_guest_hash);
    SELECT o.* INTO prior FROM public.booking_create_operations o WHERE o.id=p_id FOR NO KEY UPDATE;
    IF prior.actor_was_authenticated IS DISTINCT FROM (p_actor_id IS NOT NULL) OR prior.actor_user_id IS DISTINCT FROM p_actor_id
      OR prior.guest_scope_hash IS DISTINCT FROM p_guest_hash THEN RAISE EXCEPTION 'BOOKING_CREATE_SCOPE_CONFLICT'; END IF;
    IF prior.payload_hash IS DISTINCT FROM p_payload_hash OR prior.facility_id IS DISTINCT FROM p_facility_id THEN RAISE EXCEPTION 'BOOKING_CREATE_PAYLOAD_CONFLICT'; END IF;
    IF prior.booking_id IS NULL THEN RAISE EXCEPTION 'BOOKING_CREATE_RETIRED'; END IF;
    RETURN QUERY SELECT prior.response_payload,true; RETURN;
  END IF;
  IF jsonb_typeof(p_notifications) IS DISTINCT FROM 'array' OR jsonb_array_length(p_notifications)>250 THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_notifications) x WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'object'
    OR jsonb_typeof(x.value->'kind') IS DISTINCT FROM 'string' OR x.value->>'kind' NOT IN ('email','push','line','line_works')
    OR jsonb_typeof(x.value->'target') IS DISTINCT FROM 'string' OR length(x.value->>'target') NOT BETWEEN 1 AND 320
    OR jsonb_typeof(x.value->'role') IS DISTINCT FROM 'string' OR x.value->>'role' NOT IN ('customer','owner','staff')
    OR (x.value->>'role'='staff' AND x.value->>'kind'<>'line_works')
    OR (x.value->>'kind' IN ('line','line_works') AND x.value->>'role' IS DISTINCT FROM CASE WHEN x.value->>'kind'='line' THEN 'customer' ELSE 'staff' END)
    OR (x.value->>'role'='owner' AND (x.value->>'user_id' IS NULL OR x.value->>'user_id' !~ '^[a-f0-9-]{36}$')))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_notifications) x GROUP BY x.value->>'kind',x.value->>'target',x.value->>'role' HAVING count(*)>1)
    THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_INVALID'; END IF;
  context:=p_notifications->0->'context';
  IF jsonb_typeof(context) IS DISTINCT FROM 'object' OR jsonb_typeof(context->'owner_ids') IS DISTINCT FROM 'array'
    OR jsonb_array_length(context->'owner_ids')>250 OR jsonb_typeof(context->'owner_push') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(context->'works_enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(context->'line_enabled') IS DISTINCT FROM 'boolean'
    OR p_notifications->0->>'kind' IS DISTINCT FROM 'email' OR p_notifications->0->>'role' IS DISTINCT FROM 'customer'
    THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_INVALID'; END IF;
  owner_ids:=ARRAY(SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(context->'owner_ids') ORDER BY value::uuid);
  FOR uid IN SELECT DISTINCT x FROM unnest(owner_ids||ARRAY[p_actor_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM public.lock_booking_account(uid);
  END LOOP;
  PERFORM public.lock_booking_create_scope(p_id,p_actor_id,p_guest_hash);
  SELECT o.* INTO prior FROM public.booking_create_operations o WHERE o.id=p_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_CREATE_NOT_PREPARED'; END IF;
  IF prior.actor_was_authenticated IS DISTINCT FROM (p_actor_id IS NOT NULL)
    OR prior.actor_user_id IS DISTINCT FROM p_actor_id OR prior.guest_scope_hash IS DISTINCT FROM p_guest_hash
    THEN RAISE EXCEPTION 'BOOKING_CREATE_SCOPE_CONFLICT'; END IF;
  IF prior.payload_hash IS DISTINCT FROM p_payload_hash OR prior.facility_id IS DISTINCT FROM p_facility_id THEN RAISE EXCEPTION 'BOOKING_CREATE_PAYLOAD_CONFLICT'; END IF;
  IF prior.state='committed' THEN
    IF prior.booking_id IS NULL THEN RAISE EXCEPTION 'BOOKING_CREATE_RETIRED'; END IF;
    RETURN QUERY SELECT prior.response_payload,true; RETURN;
  END IF;
  IF prior.state<>'prepared' THEN RAISE EXCEPTION 'BOOKING_CREATE_CLOSED'; END IF;
  IF to_regprocedure('public.webhook_dispatch_v2_version()') IS NULL THEN RAISE EXCEPTION 'WEBHOOK_DISPATCH_V2_UNAVAILABLE'; END IF;
  IF public.webhook_dispatch_v2_version() IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'WEBHOOK_DISPATCH_V2_UNAVAILABLE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('carelink-staff-schedule:'||p_facility_id::text,0));
  -- Weak parent -> existing member SHARE -> parent NO KEY UPDATE avoids the
  -- KEY SHARE upgrade cycle shared with photo/moderation/retirement paths.
  PERFORM f.id FROM public.facility_profiles f WHERE f.id=p_facility_id FOR KEY SHARE;
  PERFORM m.id FROM public.facility_members m WHERE m.facility_id=p_facility_id ORDER BY m.id FOR SHARE;
  PERFORM f.id FROM public.facility_profiles f WHERE f.id=p_facility_id FOR NO KEY UPDATE;
  PERFORM p.id FROM public.profiles p WHERE p.id=ANY(owner_ids) ORDER BY p.id FOR SHARE;
  PERFORM s.id FROM public.staff_profiles s WHERE s.facility_id=p_facility_id ORDER BY s.id FOR SHARE;
  SELECT coalesce(n.push_on_new_booking,true) INTO actual_owner_push FROM public.facility_notification_settings n WHERE n.facility_id=p_facility_id FOR SHARE;
  IF NOT FOUND THEN actual_owner_push:=true; END IF;
  expected_line:=NULL;
  IF (context->>'line_enabled')::boolean AND p_actor_id IS NOT NULL THEN
    SELECT p.line_user_id INTO expected_line FROM public.profiles p WHERE p.id=p_actor_id FOR SHARE;
    IF expected_line IS NOT NULL THEN
      PERFORM l.id FROM public.line_user_links l WHERE l.user_id=p_actor_id AND l.line_user_id=expected_line AND l.proof_version=1 AND l.verified_at IS NOT NULL FOR SHARE;
      IF NOT FOUND THEN expected_line:=NULL; END IF;
    END IF;
  END IF;
  -- This one READ COMMITTED snapshot is the recipient-set linearization point.
  -- Owners added after this check do not receive a past reservation notice.
  SELECT ARRAY(SELECT DISTINCT m.user_id FROM public.facility_members m WHERE m.facility_id=p_facility_id AND m.role IN ('owner','admin') ORDER BY m.user_id),
    ARRAY(SELECT DISTINCT p.email FROM public.profiles p JOIN public.facility_members m ON m.user_id=p.id WHERE m.facility_id=p_facility_id AND m.role IN ('owner','admin') AND nullif(p.email,'') IS NOT NULL ORDER BY p.email),
    ARRAY(SELECT DISTINCT s.line_works_channel_id FROM public.staff_profiles s WHERE (context->>'works_enabled')::boolean AND s.facility_id=p_facility_id AND (s.id=p_staff_id OR s.line_works_notify_all) AND s.line_works_channel_id IS NOT NULL ORDER BY s.line_works_channel_id)
    INTO actual_owners,expected_emails,expected_works;
  IF actual_owners IS DISTINCT FROM owner_ids OR actual_owner_push IS DISTINCT FROM (context->>'owner_push')::boolean THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_TARGET_CHANGED'; END IF;
  given_emails:=ARRAY(SELECT DISTINCT x.value->>'target' FROM jsonb_array_elements(p_notifications) x WHERE x.value->>'kind'='email' AND x.value->>'role'='owner' ORDER BY x.value->>'target');
  given_push:=ARRAY(SELECT DISTINCT (x.value->>'user_id')::uuid FROM jsonb_array_elements(p_notifications) x WHERE x.value->>'kind'='push' AND x.value->>'role'='owner' ORDER BY (x.value->>'user_id')::uuid);
  expected_push:=CASE WHEN actual_owner_push THEN owner_ids ELSE ARRAY[]::uuid[] END;
  given_works:=ARRAY(SELECT DISTINCT x.value->>'target' FROM jsonb_array_elements(p_notifications) x WHERE x.value->>'kind'='line_works' ORDER BY x.value->>'target');
  given_line:=ARRAY(SELECT DISTINCT x.value->>'target' FROM jsonb_array_elements(p_notifications) x WHERE x.value->>'kind'='line' ORDER BY x.value->>'target');
  IF expected_emails IS DISTINCT FROM given_emails OR expected_push IS DISTINCT FROM given_push OR expected_works IS DISTINCT FROM given_works
    OR given_line IS DISTINCT FROM (CASE WHEN expected_line IS NULL THEN ARRAY[]::text[] ELSE ARRAY[expected_line] END)
    OR (SELECT count(*) FROM jsonb_array_elements(p_notifications) x WHERE x.value->>'kind'='email' AND x.value->>'role'='customer')<>1
    OR (SELECT count(*) FROM jsonb_array_elements(p_notifications) x WHERE x.value->>'kind'='push' AND x.value->>'role'='customer')<>(CASE WHEN p_actor_id IS NULL THEN 0 ELSE 1 END)
    THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_TARGET_CHANGED'; END IF;
  booking_new_id:=public.create_online_booking_atomic(p_facility_id,p_staff_id,p_actor_id,p_menu_id,p_coupon_id,p_booking_date,p_start_time,p_end_time,
    p_customer_name,p_email,p_phone,p_note,p_total_price,p_points_used,p_status,p_menu_ids);
  SELECT * INTO b FROM public.bookings WHERE bookings.id=booking_new_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_CREATE_RESULT_INVALID'; END IF;
  SELECT jsonb_build_object('customer_name',b.customer_name,'email',b.email,'facility_name',f.name,'menu_name',m.name,'staff_name',s.name,'booking_date',b.booking_date::text,'start_time',to_char(b.start_time,'HH24:MI'),'end_time',to_char(b.end_time,'HH24:MI'),'total_price',b.total_price,'status',b.status) INTO snapshot FROM public.facility_profiles f JOIN public.facility_menus m ON m.id=b.menu_id
    LEFT JOIN public.staff_profiles s ON s.id=b.staff_id WHERE f.id=b.facility_id;
  FOR item IN SELECT value FROM jsonb_array_elements(p_notifications) LOOP
    target:=item->>'target'; kind:=item->>'kind'; envelope:=item->'envelope'; qid:=gen_random_uuid();
    IF item->'snapshot' IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_SNAPSHOT_CHANGED'; END IF;
    frozen:=CASE WHEN kind='push' AND item->>'role'='owner' THEN snapshot-ARRAY['email','facility_name','menu_name','staff_name','end_time','total_price','status']
      WHEN kind='push' THEN snapshot-ARRAY['customer_name','email','facility_name','menu_name','staff_name','end_time','total_price','status']
      WHEN kind='line' THEN snapshot-ARRAY['customer_name','email','end_time','total_price','status']
      WHEN kind='line_works' THEN snapshot-ARRAY['email','facility_name','end_time','total_price','status']
      ELSE snapshot END;
    IF item->>'role'='owner' THEN
      PERFORM m.user_id FROM public.facility_members m JOIN public.profiles p ON p.id=m.user_id
        WHERE m.facility_id=p_facility_id AND m.user_id=(item->>'user_id')::uuid AND m.role IN ('owner','admin')
          AND (kind<>'email' OR p.email=target) FOR SHARE OF m,p;
      IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_TARGET_CHANGED'; END IF;
    ELSIF item->>'role' IS DISTINCT FROM 'customer' AND kind<>'line_works' THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_INVALID'; END IF;
    IF kind='email' THEN
      IF jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR envelope->>'to' IS DISTINCT FROM target
        OR (SELECT count(*) FROM jsonb_object_keys(envelope))<>4 OR length(envelope->>'from') NOT BETWEEN 1 AND 320
        OR length(envelope->>'subject') NOT BETWEEN 1 AND 200 OR length(envelope->>'html') NOT BETWEEN 1 AND 100000
        OR jsonb_typeof(envelope->'from') IS DISTINCT FROM 'string' OR jsonb_typeof(envelope->'to') IS DISTINCT FROM 'string'
        OR jsonb_typeof(envelope->'subject') IS DISTINCT FROM 'string' OR jsonb_typeof(envelope->'html') IS DISTINCT FROM 'string'
        OR nullif(envelope->>'from','') IS NULL OR nullif(envelope->>'subject','') IS NULL OR nullif(envelope->>'html','') IS NULL
        OR (item->>'role'='customer' AND target IS DISTINCT FROM p_email) THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_INVALID'; END IF;
      INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload,email_envelope,status,scheduled_at)
        VALUES(qid,'email',target,p_facility_id,jsonb_build_object('event_email_version',1,'idempotency_key','carelink-event-email/'||qid::text,
          'dispatch_version',2,'booking_snapshot',frozen,'booking_create_operation',p_id::text,'booking_id',booking_new_id::text,'booking_role',item->>'role','booking_target_user',item->>'user_id'),envelope,'pending',clock_timestamp());
    ELSIF kind='push' THEN
      IF jsonb_typeof(item->'payload') IS DISTINCT FROM 'object' OR jsonb_typeof(item->'payload'->'title') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'payload'->'body') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_INVALID'; END IF;
      IF (item->>'role'='customer' AND (p_actor_id IS NULL OR target IS DISTINCT FROM p_actor_id::text))
        OR (item->>'role'='owner' AND target IS DISTINCT FROM item->>'user_id') THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_TARGET_CHANGED'; END IF;
      INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload,status,scheduled_at)
        VALUES(qid,'booking_creation_push',target,p_facility_id,
          coalesce(item->'payload','{}'::jsonb)||jsonb_build_object('tag',CASE WHEN item->>'role'='customer' THEN 'booking-confirm-' ELSE 'booking-' END||booking_new_id::text,
          'url',CASE WHEN item->>'role'='customer' THEN '/mypage/bookings/'||booking_new_id::text ELSE '/admin/bookings' END,
          'dispatch_version',2,'booking_snapshot',frozen,'booking_create_operation',p_id::text,'booking_id',booking_new_id::text,'booking_role',item->>'role','booking_target_user',item->>'user_id'), 'pending',clock_timestamp());
    ELSIF kind='line' THEN
      IF jsonb_typeof(item->'payload') IS DISTINCT FROM 'object' OR jsonb_typeof(item->'payload'->'message') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_INVALID'; END IF;
      PERFORM p.id FROM public.profiles p WHERE p.id=p_actor_id AND p.line_user_id=target FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_TARGET_CHANGED'; END IF;
      PERFORM l.id FROM public.line_user_links l WHERE l.user_id=p_actor_id AND l.line_user_id=target AND l.proof_version=1 AND l.verified_at IS NOT NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_TARGET_CHANGED'; END IF;
      INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload,status,scheduled_at)
        VALUES(qid,'line_push',target,p_facility_id,
          coalesce(item->'payload','{}'::jsonb)||jsonb_build_object('dispatch_version',2,'booking_snapshot',frozen,'booking_create_operation',p_id::text,'booking_id',booking_new_id::text,'booking_role',item->>'role'),'pending',clock_timestamp());
    ELSIF kind='line_works' THEN
      IF jsonb_typeof(item->'payload') IS DISTINCT FROM 'object' OR jsonb_typeof(item->'payload'->'customerName') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'payload'->'menuName') IS DISTINCT FROM 'string' OR item->'payload'->>'bookingDate' IS DISTINCT FROM p_booking_date::text
        OR item->'payload'->>'startTime' IS DISTINCT FROM to_char(p_start_time,'HH24:MI') THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_INVALID'; END IF;
      PERFORM s.id FROM public.staff_profiles s WHERE s.facility_id=p_facility_id AND s.line_works_channel_id=target
        AND (s.id=p_staff_id OR s.line_works_notify_all) FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOTIFICATION_TARGET_CHANGED'; END IF;
      INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload,status,scheduled_at)
        VALUES(qid,'booking_creation_lineworks',target,p_facility_id,
          coalesce(item->'payload','{}'::jsonb)||jsonb_build_object('dispatch_version',2,'booking_snapshot',frozen,'booking_create_operation',p_id::text,'booking_id',booking_new_id::text,'booking_role',item->>'role'),'pending',clock_timestamp());
    ELSE RAISE EXCEPTION 'BOOKING_NOTIFICATION_INVALID'; END IF;
  END LOOP;
  response:=jsonb_build_object('success',true,'state','accepted','operationId',p_id::text,'bookingId',booking_new_id::text,
    'bookingStatus',b.status,'bookingDate',b.booking_date::text,'startTime',to_char(b.start_time,'HH24:MI'),'endTime',to_char(b.end_time,'HH24:MI'),
    'totalPrice',b.total_price,'notification','queued');
  UPDATE public.booking_create_operations SET state='committed',booking_id=booking_new_id,response_payload=response WHERE booking_create_operations.id=p_id;
  RETURN QUERY SELECT response,false;
END $$;
REVOKE ALL ON FUNCTION public.create_booking_with_receipt_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_with_receipt_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[],jsonb) TO service_role;
-- An old deployment cannot bypass the durable receipt by calling its former
-- creation entrypoint. The secured new wrapper calls it as the function owner.
REVOKE EXECUTE ON FUNCTION public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[]) FROM service_role;

-- Stable identities survive claim/retry transitions; a reset cannot replace the recipient or payload.
CREATE FUNCTION public.guard_booking_create_queue_identity() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF OLD.payload->>'booking_create_operation' IS NOT NULL AND (NEW.webhook_type IS DISTINCT FROM OLD.webhook_type
    OR NEW.target_id IS DISTINCT FROM OLD.target_id OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
    OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.email_envelope IS DISTINCT FROM OLD.email_envelope) THEN
    RAISE EXCEPTION 'BOOKING_CREATE_NOTIFICATION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_create_queue_identity BEFORE UPDATE ON public.webhook_retry_queue FOR EACH ROW EXECUTE FUNCTION public.guard_booking_create_queue_identity();
REVOKE ALL ON FUNCTION public.guard_booking_create_queue_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE UNIQUE INDEX booking_create_queue_identity_unique ON public.webhook_retry_queue((payload->>'booking_create_operation'),webhook_type,target_id,(payload->>'booking_role'))
  WHERE payload->>'booking_create_operation' IS NOT NULL;

CREATE FUNCTION public.start_booking_create_notification(p_queue_id uuid,p_claimed_at timestamptz)
RETURNS TABLE(outcome text,started_at timestamptz) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE q public.webhook_retry_queue%ROWTYPE; o public.booking_create_operations%ROWTYPE; uid uuid; recipient uuid; valid boolean:=false; epoch timestamptz; current_booking public.bookings%ROWTYPE; snapshot jsonb; snapshot_matches boolean:=false;
BEGIN
  SELECT * INTO q FROM public.webhook_retry_queue WHERE id=p_queue_id;
  IF NOT FOUND OR q.payload->>'booking_create_operation' IS NULL THEN RAISE EXCEPTION 'BOOKING_CREATE_NOTIFICATION_INVALID'; END IF;
  SELECT * INTO o FROM public.booking_create_operations WHERE id=(q.payload->>'booking_create_operation')::uuid;
  IF NOT FOUND OR o.state<>'committed' OR o.booking_id::text IS DISTINCT FROM q.payload->>'booking_id' OR o.facility_id IS DISTINCT FROM q.facility_id THEN
    RAISE EXCEPTION 'BOOKING_CREATE_NOTIFICATION_INVALID';
  END IF;
  recipient:=nullif(q.payload->>'booking_target_user','')::uuid;
  FOR uid IN SELECT DISTINCT x FROM unnest(ARRAY[o.actor_user_id,recipient]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM public.lock_booking_account(uid);
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('carelink-booking-create:'||o.id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('carelink-staff-schedule:'||o.facility_id::text,0));
  PERFORM f.id FROM public.facility_profiles f WHERE f.id=o.facility_id FOR SHARE;
  SELECT * INTO current_booking FROM public.bookings WHERE id=o.booking_id FOR SHARE;
  IF FOUND AND current_booking.status IN ('pending','confirmed') THEN
    PERFORM m.id FROM public.facility_menus m WHERE m.id=current_booking.menu_id FOR SHARE;
    PERFORM s.id FROM public.staff_profiles s WHERE s.id=current_booking.staff_id FOR SHARE;
    SELECT jsonb_build_object('customer_name',current_booking.customer_name,'email',current_booking.email,'facility_name',f.name,'menu_name',m.name,'staff_name',s.name,'booking_date',current_booking.booking_date::text,'start_time',to_char(current_booking.start_time,'HH24:MI'),'end_time',to_char(current_booking.end_time,'HH24:MI'),'total_price',current_booking.total_price,'status',current_booking.status) INTO snapshot FROM public.facility_profiles f JOIN public.facility_menus m ON m.id=current_booking.menu_id
      LEFT JOIN public.staff_profiles s ON s.id=current_booking.staff_id WHERE f.id=current_booking.facility_id;
    snapshot_matches:=jsonb_typeof(q.payload->'booking_snapshot') IS NOT DISTINCT FROM 'object'
      AND q.payload->'booking_snapshot'<>'{}'::jsonb AND (snapshot @> (q.payload->'booking_snapshot')) IS TRUE;
  END IF;
  IF q.payload->>'booking_role'='owner' THEN
    PERFORM m.user_id FROM public.facility_members m JOIN public.profiles p ON p.id=m.user_id
      WHERE m.user_id=recipient AND m.facility_id=o.facility_id AND m.role IN ('owner','admin')
        AND (q.webhook_type<>'email' OR p.email=q.target_id) FOR SHARE OF m,p;
    valid:=FOUND;
  ELSIF q.webhook_type='email' THEN
    PERFORM b.id FROM public.bookings b WHERE b.id=o.booking_id AND b.email=q.target_id FOR SHARE;
    valid:=FOUND;
  ELSIF q.webhook_type='booking_creation_push' THEN
    valid:=o.actor_user_id IS NOT NULL AND q.target_id=o.actor_user_id::text;
  ELSIF q.webhook_type='line_push' THEN
    PERFORM p.id FROM public.profiles p WHERE p.id=o.actor_user_id AND p.line_user_id=q.target_id FOR SHARE; valid:=FOUND;
    IF valid THEN PERFORM l.id FROM public.line_user_links l WHERE l.user_id=o.actor_user_id AND l.line_user_id=q.target_id AND l.proof_version=1 AND l.verified_at IS NOT NULL FOR SHARE; valid:=FOUND; END IF;
  ELSIF q.webhook_type='booking_creation_lineworks' THEN
    PERFORM s.id FROM public.staff_profiles s JOIN public.bookings b ON b.id=o.booking_id
      WHERE s.facility_id=o.facility_id AND s.line_works_channel_id=q.target_id AND (s.id=b.staff_id OR s.line_works_notify_all) FOR SHARE OF s;
    valid:=FOUND;
  END IF;
  valid:=valid AND snapshot_matches;
  IF q.webhook_type='booking_creation_push' AND valid THEN
    PERFORM p.user_id FROM public.push_subscriptions p WHERE p.user_id=q.target_id::uuid FOR SHARE;
    valid:=FOUND;
  END IF;
  SELECT * INTO q FROM public.webhook_retry_queue WHERE id=p_queue_id FOR NO KEY UPDATE;
  IF NOT FOUND OR q.status<>'processing' OR q.claimed_at IS DISTINCT FROM p_claimed_at OR q.delivery_started_at IS NOT NULL THEN
    RETURN QUERY SELECT 'not_owned'::text,NULL::timestamptz; RETURN;
  END IF;
  IF NOT valid THEN
    UPDATE public.webhook_retry_queue SET status='failed',last_error='booking_create_notification_superseded',processed_at=clock_timestamp() WHERE id=p_queue_id;
    RETURN QUERY SELECT 'superseded'::text,NULL::timestamptz; RETURN;
  END IF;
  epoch:=clock_timestamp();
  UPDATE public.webhook_retry_queue SET delivery_started_at=epoch WHERE id=p_queue_id;
  RETURN QUERY SELECT 'ready'::text,epoch;
END $$;
REVOKE ALL ON FUNCTION public.start_booking_create_notification(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_booking_create_notification(uuid,timestamptz) TO service_role;

-- M09: authorization belongs to the same transaction as the final write.
-- Notification reservation is atomic with a status transition, and repeated
-- adjustment requests for the same booking revision share a durable event.
-- Auth CASCADE and concurrent departures suspend the last-owned facility in
-- that same transaction. A separate API count is not the final guarantee.
CREATE FUNCTION public.suspend_last_owned_facility() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.role = 'owner' AND (TG_OP = 'DELETE' OR NEW.role IS DISTINCT FROM 'owner'
    OR NEW.facility_id IS DISTINCT FROM OLD.facility_id) THEN
    PERFORM 1 FROM public.facility_profiles WHERE id=OLD.facility_id FOR UPDATE;
    IF NOT EXISTS(SELECT 1 FROM public.facility_members WHERE facility_id=OLD.facility_id AND role='owner') THEN
      UPDATE public.facility_profiles SET status='suspended',
        updated_at=clock_timestamp() WHERE id=OLD.facility_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.suspend_last_owned_facility() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER suspend_last_owned_facility AFTER DELETE OR UPDATE OF role,facility_id ON public.facility_members
  FOR EACH ROW EXECUTE FUNCTION public.suspend_last_owned_facility();

-- The final deletion, not an earlier HTTP COUNT, enforces the retirement guard.
-- Lock order matches manual writes: membership -> profile. A booking already
-- holding those SHARE locks commits before this fresh READ COMMITTED check.
-- Later manual writes cannot pass the deleted membership; public writes retain
-- the profile SHARE lock and require booking readiness. Own-user booking FKs
-- take KEY SHARE on this Auth row, preventing an insert past the final delete.
CREATE FUNCTION public.guard_account_deletion_active_bookings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM m.id FROM public.facility_members m WHERE m.user_id=OLD.id AND m.role='owner'
    ORDER BY m.facility_id,m.id FOR UPDATE;
  PERFORM p.id FROM public.facility_profiles p WHERE EXISTS(SELECT 1 FROM public.facility_members m
    WHERE m.user_id=OLD.id AND m.role='owner' AND m.facility_id=p.id) ORDER BY p.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.bookings b WHERE b.status IN ('pending','confirmed','arrived')
    AND b.booking_date >= (clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date
    AND (b.user_id=OLD.id OR EXISTS(SELECT 1 FROM public.facility_members m
      WHERE m.user_id=OLD.id AND m.role='owner' AND m.facility_id=b.facility_id)))
  THEN RAISE EXCEPTION 'ACCOUNT_ACTIVE_BOOKINGS_PREVENT_DELETION'; END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_account_deletion_active_bookings() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_account_deletion_active_bookings BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_active_bookings();

CREATE FUNCTION public.update_facility_settings_atomic(p_actor_id uuid, p_facility_id uuid, p_patch jsonb)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE f public.facility_profiles%ROWTYPE; n public.facility_profiles%ROWTYPE; assignments text;
BEGIN
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch='{}'::jsonb OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k <> ALL(ARRAY[
      'name','business_type','catch_copy','description','postal_code','prefecture','city','address','building',
      'access_info','nearest_station','phone','website_url','seat_count','staff_count','parking','credit_card',
      'features','regular_holiday','business_hours','booking_auto_confirm','booking_buffer_minutes',
      'board_slot_minutes','main_photo_url','status','updated_at'])) THEN RAISE EXCEPTION 'INVALID_FACILITY_PATCH'; END IF;
  PERFORM 1 FROM public.facility_members m WHERE m.facility_id=p_facility_id AND m.user_id=p_actor_id
    AND m.role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_PERMISSION_REVOKED'; END IF;
  SELECT * INTO f FROM public.facility_profiles p WHERE p.id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_NOT_FOUND'; END IF;
  n := jsonb_populate_record(f,p_patch);
  IF n.status='published' AND NOT EXISTS(SELECT 1 FROM public.facility_members
    WHERE facility_id=p_facility_id AND role='owner') THEN RAISE EXCEPTION 'FACILITY_OWNER_REQUIRED'; END IF;
  IF n.status='published' AND (n.name IS NULL OR n.prefecture IS NULL OR n.city IS NULL OR n.address IS NULL
    OR n.name !~ '[^[:space:]　]' OR n.prefecture !~ '[^[:space:]　]' OR n.city !~ '[^[:space:]　]' OR n.address !~ '[^[:space:]　]')
    THEN RAISE check_violation USING MESSAGE='"published_facility_location_present"'; END IF;
  SELECT string_agg(format('%I=x.%I',k,k),',') INTO assignments FROM jsonb_object_keys(p_patch) k WHERE k <> 'updated_at';
  IF assignments IS NULL THEN RAISE EXCEPTION 'INVALID_FACILITY_PATCH'; END IF;
  RETURN QUERY EXECUTE format('UPDATE public.facility_profiles p SET %s,updated_at=clock_timestamp()
    FROM jsonb_populate_record(NULL::public.facility_profiles,$2) x WHERE p.id=$1 RETURNING p.id',assignments)
    USING p_facility_id,to_jsonb(n);
END;
$$;
REVOKE ALL ON FUNCTION public.update_facility_settings_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_facility_settings_atomic(uuid,uuid,jsonb) TO service_role;

ALTER TABLE public.webhook_retry_queue
  ADD COLUMN booking_event_id uuid,
  ADD COLUMN booking_event_revision timestamptz,
  ADD COLUMN booking_event_kind text;
ALTER TABLE public.webhook_retry_queue ADD CONSTRAINT booking_email_event_shape CHECK (
  (booking_event_id IS NULL AND booking_event_revision IS NULL AND booking_event_kind IS NULL)
  OR (booking_event_id IS NOT NULL AND booking_event_revision IS NOT NULL
      AND booking_event_kind IN ('status', 'adjust') AND webhook_type = 'email'
      AND payload->>'event_email_version' = '1' AND email_envelope IS NOT NULL)
);
CREATE UNIQUE INDEX booking_email_event_once
  ON public.webhook_retry_queue(booking_event_id, booking_event_revision, booking_event_kind)
  WHERE booking_event_kind IS NOT NULL;
CREATE FUNCTION public.guard_booking_email_event_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.booking_event_kind IS NOT NULL AND (
    NEW.booking_event_id IS DISTINCT FROM OLD.booking_event_id
    OR NEW.booking_event_revision IS DISTINCT FROM OLD.booking_event_revision
    OR NEW.booking_event_kind IS DISTINCT FROM OLD.booking_event_kind
  ) THEN RAISE EXCEPTION 'BOOKING_EMAIL_EVENT_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_booking_email_event_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_booking_email_event_identity BEFORE UPDATE ON public.webhook_retry_queue
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_email_event_identity();

-- Client identities survive a lost HTTP response and a subsequent booking revision.
-- Retain the opaque tombstone even when the notification queue is cleaned up.
CREATE TABLE public.booking_adjust_operations (
  operation_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  queue_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_adjust_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_adjust_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.booking_adjust_operations TO service_role;

CREATE FUNCTION public.set_facilities_publication_atomic(
  p_actor_id uuid, p_facility_ids uuid[], p_is_published boolean
) RETURNS TABLE(id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE f public.facility_profiles%ROWTYPE; fid uuid;
BEGIN
  IF p_actor_id IS NULL OR p_is_published IS NULL OR p_facility_ids IS NULL
    OR cardinality(p_facility_ids) NOT BETWEEN 1 AND 50
    OR EXISTS(SELECT 1 FROM unnest(p_facility_ids) x WHERE x IS NULL)
    OR (SELECT count(DISTINCT x) FROM unnest(p_facility_ids) x) <> cardinality(p_facility_ids)
  THEN RAISE EXCEPTION 'INVALID_PUBLICATION_INPUT'; END IF;
  FOR fid IN SELECT x FROM unnest(p_facility_ids) x ORDER BY x LOOP
    PERFORM 1 FROM public.facility_members m WHERE m.user_id = p_actor_id
      AND m.facility_id = fid AND m.role IN ('owner','admin') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_PERMISSION_REVOKED'; END IF;
  END LOOP;
  FOR fid IN SELECT x FROM unnest(p_facility_ids) x ORDER BY x LOOP
    SELECT * INTO f FROM public.facility_profiles p WHERE p.id = fid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_NOT_FOUND'; END IF;
    -- Auth CASCADE takes this same profile lock and suspends at commit. If
    -- deletion fails, a still-authorized owner can recover normally. An admin
    -- cannot reopen an ownerless facility after the deletion commits.
    IF p_is_published AND NOT EXISTS(SELECT 1 FROM public.facility_members
      WHERE facility_id=fid AND role='owner') THEN RAISE EXCEPTION 'FACILITY_OWNER_REQUIRED'; END IF;
    IF p_is_published AND (f.name !~ '[^[:space:]　]' OR f.prefecture !~ '[^[:space:]　]'
      OR f.city !~ '[^[:space:]　]' OR f.address !~ '[^[:space:]　]'
      OR f.name IS NULL OR f.prefecture IS NULL OR f.city IS NULL OR f.address IS NULL)
    THEN RAISE check_violation USING MESSAGE = '"published_facility_location_present"'; END IF;
  END LOOP;
  RETURN QUERY UPDATE public.facility_profiles p SET
    status = CASE WHEN p_is_published THEN 'published' ELSE 'draft' END,
    updated_at = clock_timestamp() WHERE p.id = ANY(p_facility_ids) RETURNING p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_facilities_publication_atomic(uuid,uuid[],boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_facilities_publication_atomic(uuid,uuid[],boolean) TO service_role;

CREATE FUNCTION public.save_booking_email_event_atomic(
  p_actor_id uuid, p_booking_id uuid, p_expected_status text,
  p_expected_updated_at timestamptz, p_new_status text, p_envelope jsonb,
  p_operation_id uuid DEFAULT NULL
) RETURNS TABLE(operation_id uuid, replayed boolean, notification text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE b public.bookings%ROWTYPE; fid uuid; op uuid; rev timestamptz; kind text;
  prior public.booking_adjust_operations%ROWTYPE;
BEGIN
  kind := CASE WHEN p_new_status IS NULL THEN 'adjust' ELSE 'status' END;
  IF kind = 'adjust' THEN
    IF p_operation_id IS NULL THEN RAISE EXCEPTION 'INVALID_OPERATION_ID'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('booking-adjust/' || p_operation_id::text, 0));
  END IF;
  SELECT facility_id INTO fid FROM public.bookings WHERE id = p_booking_id;
  IF fid IS NULL THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  PERFORM 1 FROM public.facility_members m WHERE m.facility_id = fid AND m.user_id = p_actor_id
    AND m.role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id = p_booking_id AND facility_id = fid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_PERMISSION_DENIED'; END IF;
  IF kind = 'adjust' THEN
    SELECT a.* INTO prior FROM public.booking_adjust_operations a WHERE a.operation_id = p_operation_id;
    IF FOUND THEN
      IF prior.actor_id IS DISTINCT FROM p_actor_id OR prior.booking_id IS DISTINCT FROM p_booking_id
        THEN RAISE EXCEPTION 'BOOKING_OPERATION_CONFLICT'; END IF;
      RETURN QUERY SELECT prior.queue_id, true, 'already_queued'::text; RETURN;
    END IF;
  END IF;
  IF kind = 'adjust' AND b.status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'INVALID_BOOKING_TRANSITION'; END IF;
  IF b.status IS DISTINCT FROM p_expected_status OR b.updated_at IS DISTINCT FROM p_expected_updated_at
    THEN RAISE EXCEPTION 'BOOKING_REVISION_CONFLICT'; END IF;
  IF kind = 'status' AND NOT (
    (b.status = 'pending' AND p_new_status IN ('confirmed','cancelled')) OR
    (b.status = 'confirmed' AND p_new_status IN ('arrived','completed','cancelled','no_show')) OR
    (b.status = 'arrived' AND p_new_status IN ('completed','cancelled','no_show')) OR
    (b.status = 'completed' AND p_new_status = 'no_show') OR
    (b.status = 'no_show' AND p_new_status = 'cancelled')
  ) THEN RAISE EXCEPTION 'INVALID_BOOKING_TRANSITION'; END IF;
  IF b.email IS NULL OR p_new_status = 'arrived' THEN
    IF kind = 'adjust' THEN RAISE EXCEPTION 'BOOKING_EMAIL_MISSING'; END IF;
    IF p_envelope IS NOT NULL THEN RAISE EXCEPTION 'INVALID_BOOKING_EMAIL'; END IF;
  ELSIF p_envelope IS NULL OR p_envelope->>'to' IS DISTINCT FROM b.email
    OR nullif(p_envelope->>'from','') IS NULL OR nullif(p_envelope->>'subject','') IS NULL
    OR nullif(p_envelope->>'html','') IS NULL THEN RAISE EXCEPTION 'INVALID_BOOKING_EMAIL'; END IF;
  IF kind = 'status' THEN
    rev := clock_timestamp();
    UPDATE public.bookings SET status = p_new_status, updated_at = rev WHERE id = b.id;
  ELSE rev := coalesce(b.updated_at, b.created_at); END IF;
  IF p_envelope IS NULL THEN RETURN QUERY SELECT NULL::uuid, false, 'not_requested'::text; RETURN; END IF;
  SELECT q.id INTO op FROM public.webhook_retry_queue q WHERE q.booking_event_id = b.id
    AND q.booking_event_revision = rev AND q.booking_event_kind = kind;
  IF op IS NOT NULL THEN
    IF kind = 'adjust' THEN INSERT INTO public.booking_adjust_operations(operation_id,actor_id,booking_id,queue_id)
      VALUES(p_operation_id,p_actor_id,b.id,op); END IF;
    RETURN QUERY SELECT op, true, 'already_queued'::text; RETURN;
  END IF;
  op := gen_random_uuid();
  INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,facility_id,payload,email_envelope,
    status,attempt_count,max_attempts,scheduled_at,booking_event_id,booking_event_revision,booking_event_kind)
  VALUES(op,'email',b.email,b.facility_id,jsonb_build_object('event_email_version',1,
    'idempotency_key','carelink-event-email/' || op::text),p_envelope,'pending',0,3,clock_timestamp(),b.id,rev,kind);
  IF kind = 'adjust' THEN INSERT INTO public.booking_adjust_operations(operation_id,actor_id,booking_id,queue_id)
    VALUES(p_operation_id,p_actor_id,b.id,op); END IF;
  RETURN QUERY SELECT op, false, 'queued'::text;
END;
$$;
REVOKE ALL ON FUNCTION public.save_booking_email_event_atomic(uuid,uuid,text,timestamptz,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_booking_email_event_atomic(uuid,uuid,text,timestamptz,text,jsonb,uuid) TO service_role;

-- Linearize the final unsent-event validity check with the delivery fence.
-- Lock booking then queue, matching save_booking_email_event_atomic's order.
-- Started/unknown events are never cancelled here or returned to pending.
CREATE FUNCTION public.start_booking_email_event(p_queue_id uuid, p_claimed_at timestamptz)
RETURNS TABLE(outcome text, started_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE bid uuid; b public.bookings%ROWTYPE; q public.webhook_retry_queue%ROWTYPE; stamp timestamptz;
BEGIN
  SELECT booking_event_id INTO bid FROM public.webhook_retry_queue WHERE id = p_queue_id;
  IF bid IS NULL THEN RAISE EXCEPTION 'INVALID_BOOKING_EVENT'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id = bid FOR SHARE;
  SELECT * INTO q FROM public.webhook_retry_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND OR q.status <> 'processing' OR q.claimed_at IS DISTINCT FROM p_claimed_at
    OR q.delivery_started_at IS NOT NULL THEN
    RETURN QUERY SELECT 'not_owned'::text, NULL::timestamptz; RETURN;
  END IF;
  IF b.id IS NULL OR coalesce(b.updated_at,b.created_at) IS DISTINCT FROM q.booking_event_revision
    OR (q.booking_event_kind = 'adjust' AND b.status NOT IN ('pending','confirmed')) THEN
    UPDATE public.webhook_retry_queue SET status='cancelled', processed_at=clock_timestamp(),
      last_error='booking_event_superseded' WHERE id=q.id;
    RETURN QUERY SELECT 'superseded'::text, NULL::timestamptz; RETURN;
  END IF;
  stamp := clock_timestamp();
  UPDATE public.webhook_retry_queue SET delivery_started_at=stamp WHERE id=q.id;
  RETURN QUERY SELECT 'ready'::text, stamp;
END;
$$;
REVOKE ALL ON FUNCTION public.start_booking_email_event(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_booking_email_event(uuid,timestamptz) TO service_role;

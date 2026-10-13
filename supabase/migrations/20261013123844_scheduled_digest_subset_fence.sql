-- Forward repair: additional public news must not suppress an immutable digest.
-- Require the advertised subset to remain available, not an exact live aggregate.
CREATE FUNCTION public.scheduled_digest_snapshot_valid(p_user_id uuid,p_facilities jsonb,p_since timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE current_content jsonb;
BEGIN
 IF jsonb_typeof(p_facilities) IS DISTINCT FROM 'array' OR jsonb_array_length(p_facilities) NOT BETWEEN 1 AND 200 OR p_since IS NULL THEN RETURN false; END IF;
 current_content:=public.scheduled_digest_content(p_user_id,p_since);
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_facilities) saved WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(current_content) live
  WHERE live->>'id'=saved->>'id' AND live->>'slug'=saved->>'slug'
   AND (live->>'newCoupons')::bigint>=(saved->>'newCoupons')::bigint
   AND ((saved->>'hasNewMenus')::boolean IS NOT TRUE OR (live->>'hasNewMenus')::boolean IS TRUE)
 ));
END $$;
REVOKE ALL ON FUNCTION public.scheduled_digest_snapshot_valid(uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.scheduled_digest_snapshot_valid(uuid,jsonb,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.start_scheduled_email_delivery(p_queue_id uuid,p_claimed_at timestamptz,p_recipient_current boolean)
RETURNS TABLE(outcome text,started_at timestamptz) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.scheduled_email_operations%ROWTYPE; q public.webhook_retry_queue%ROWTYPE; b public.bookings%ROWTYPE;
 p public.profiles%ROWTYPE; valid boolean; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO o FROM public.scheduled_email_operations WHERE scheduled_email_operations.id=p_queue_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULED_EMAIL_OPERATION_NOT_FOUND'; END IF;
 IF o.kind='review_request' THEN
  PERFORM 1 FROM public.facility_profiles WHERE facility_profiles.id=(o.snapshot->>'facilityId')::uuid FOR SHARE;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=o.source_id FOR SHARE;
  valid:=b.id IS NOT NULL AND b.status='completed' AND b.updated_at IS NOT DISTINCT FROM (o.snapshot->>'bookingRevision')::timestamptz
    AND b.facility_id IS NOT DISTINCT FROM (o.snapshot->>'facilityId')::uuid AND p_recipient_current IS TRUE
    AND b.email IS NOT DISTINCT FROM o.snapshot->>'email' AND b.user_id IS NOT DISTINCT FROM (o.snapshot->>'userId')::uuid
    AND EXISTS(SELECT 1 FROM public.facility_profiles f WHERE f.id=b.facility_id AND f.status='published')
    AND (b.user_id IS NULL OR EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=b.user_id AND pr.email_unsubscribed IS NOT TRUE));
 ELSE
  SELECT * INTO p FROM public.profiles WHERE profiles.id=o.source_id FOR SHARE;
  valid:=p.id IS NOT NULL AND p.email_unsubscribed IS NOT DISTINCT FROM false AND p_recipient_current IS TRUE
    AND EXISTS(SELECT 1 FROM public.email_unsubscribe_tokens t WHERE t.token=o.snapshot->>'unsubscribeToken' AND t.user_id=o.source_id)
    AND public.scheduled_digest_snapshot_valid(o.source_id,o.snapshot->'facilities',(o.snapshot->>'since')::timestamptz);
 END IF;
 SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_retry_queue.id=p_queue_id FOR UPDATE;
 IF NOT FOUND OR q.status<>'processing' OR q.claimed_at IS DISTINCT FROM p_claimed_at OR q.delivery_started_at IS NOT NULL THEN
  RETURN QUERY SELECT 'not_owned'::text,NULL::timestamptz; RETURN;
 END IF;
 IF q.payload->'scheduled_email_version' IS DISTINCT FROM '1'::jsonb OR q.payload->>'scheduled_kind' IS DISTINCT FROM o.kind
  OR q.target_id IS DISTINCT FROM o.snapshot->>'email' OR q.email_envelope IS NULL OR q.email_envelope->>'to' IS DISTINCT FROM q.target_id THEN
  RAISE EXCEPTION 'SCHEDULED_EMAIL_FENCE_INVALID';
 END IF;
 IF valid IS DISTINCT FROM true OR stamp>=(o.snapshot->>'expiresAt')::timestamptz THEN
  UPDATE public.webhook_retry_queue SET status='failed',processed_at=stamp,last_error='scheduled_email_superseded' WHERE webhook_retry_queue.id=q.id;
  RETURN QUERY SELECT 'superseded'::text,NULL::timestamptz; RETURN;
 END IF;
 UPDATE public.webhook_retry_queue SET delivery_started_at=stamp WHERE webhook_retry_queue.id=q.id;
 RETURN QUERY SELECT 'ready'::text,stamp;
END $$;
REVOKE ALL ON FUNCTION public.start_scheduled_email_delivery(uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_scheduled_email_delivery(uuid,timestamptz,boolean) TO service_role;


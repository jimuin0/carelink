-- Review moderation binds decisions to the exact content the administrator saw.
-- Old service RPC calls cannot approve a changed/unseen review; hidden owner
-- status is independent of the moderation flag and is never restored here.
BEGIN;
CREATE FUNCTION public.review_content_hash(r public.facility_reviews) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT encode(sha256(convert_to(jsonb_build_object('id',r.id,'facility_id',r.facility_id,
    'user_id',r.user_id,'reviewer_name',r.reviewer_name,'rating',r.rating,
    'rating_skill',r.rating_skill,'rating_service',r.rating_service,
    'rating_atmosphere',r.rating_atmosphere,'rating_cleanliness',r.rating_cleanliness,
    'rating_explanation',r.rating_explanation,'comment',r.comment,'photo_urls',r.photo_urls)::text,'UTF8')),'hex');
$$;
REVOKE ALL ON FUNCTION public.review_content_hash(public.facility_reviews) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_content_hash(public.facility_reviews) TO service_role;

CREATE FUNCTION public.moderation_review_snapshot(p_actor_id uuid,p_queue_id uuid)
RETURNS TABLE(snapshot jsonb) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE profiles.id=p_actor_id AND is_platform_admin IS TRUE)
    THEN RAISE EXCEPTION 'MODERATION_PERMISSION_REVOKED'; END IF;
  RETURN QUERY SELECT jsonb_build_object('id',q.id,'content_id',q.content_id,'content_type',q.content_type,
    'status',q.status,'reviewed_at',q.reviewed_at,'content_hash',public.review_content_hash(r),
    'review',jsonb_build_object('comment',r.comment,'rating',r.rating,'photo_urls',r.photo_urls,
      'rating_skill',r.rating_skill,'rating_service',r.rating_service,'rating_atmosphere',r.rating_atmosphere,
      'rating_cleanliness',r.rating_cleanliness,'rating_explanation',r.rating_explanation))
    FROM public.moderation_queue q JOIN public.facility_reviews r ON q.content_type='review' AND r.id=q.content_id
    WHERE q.id=p_queue_id AND (q.facility_id IS NULL OR q.facility_id=r.facility_id);
END;
$$;
REVOKE ALL ON FUNCTION public.moderation_review_snapshot(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moderation_review_snapshot(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.moderate_content_atomic(
  p_actor_id uuid, p_queue_id uuid, p_expected_status text,
  p_decision text, p_review_note text DEFAULT NULL, p_expected_reviewed_at timestamptz DEFAULT NULL
) RETURNS TABLE(id uuid, content_type text, content_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE q public.moderation_queue%ROWTYPE; r public.facility_reviews%ROWTYPE;
  exact_replay boolean; locked_facility uuid;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected','escalated')
    OR p_expected_status IS NULL OR p_expected_status NOT IN ('pending','approved','rejected','escalated')
    OR char_length(p_review_note) > 500 THEN RAISE EXCEPTION 'INVALID_MODERATION_INPUT'; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM 1 FROM public.profiles p WHERE p.id=p_actor_id AND p.is_platform_admin IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MODERATION_PERMISSION_REVOKED'; END IF;
  -- Review updates also update their facility's public rating via a trigger.
  -- Lock the parent before its queue/review rows, matching parent CASCADE and
  -- photo mutations. Recheck the content's facility after taking row locks.
  SELECT coalesce(m.facility_id,v.facility_id) INTO locked_facility
    FROM public.moderation_queue m LEFT JOIN public.facility_reviews v
      ON m.content_type='review' AND v.id=m.content_id WHERE m.id=p_queue_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF locked_facility IS NOT NULL THEN
    PERFORM 1 FROM public.facility_profiles p WHERE p.id=locked_facility FOR UPDATE;
  END IF;
  SELECT * INTO q FROM public.moderation_queue m WHERE m.id=p_queue_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF q.facility_id IS NOT NULL AND q.facility_id IS DISTINCT FROM locked_facility
    THEN RAISE EXCEPTION 'MODERATION_REVISION_CONFLICT'; END IF;
  IF q.content_type='review' THEN RAISE EXCEPTION 'MODERATION_CONTENT_SNAPSHOT_REQUIRED'; END IF;
  exact_replay := q.status=p_decision AND q.review_note IS NOT DISTINCT FROM p_review_note
    AND q.reviewed_by IS NOT DISTINCT FROM p_actor_id;
  IF NOT exact_replay AND (q.status IS DISTINCT FROM p_expected_status
    OR q.reviewed_at IS DISTINCT FROM p_expected_reviewed_at)
    THEN RAISE EXCEPTION 'MODERATION_REVISION_CONFLICT'; END IF;
  IF p_decision='rejected' AND q.content_type='review' THEN
    SELECT * INTO r FROM public.facility_reviews v WHERE v.id=q.content_id FOR UPDATE;
    IF NOT FOUND OR r.facility_id IS DISTINCT FROM locked_facility
      OR (q.facility_id IS NOT NULL AND r.facility_id IS DISTINCT FROM q.facility_id)
      THEN RAISE EXCEPTION 'MODERATION_REVIEW_UNAVAILABLE'; END IF;
    UPDATE public.facility_reviews SET status='hidden',is_flagged=true,
      flag_reason=coalesce(nullif(p_review_note,''),'管理者による非承認') WHERE facility_reviews.id=r.id;
  END IF;
  IF NOT exact_replay THEN
    UPDATE public.moderation_queue SET status=p_decision,reviewed_by=p_actor_id,
      reviewed_at=clock_timestamp(),review_note=p_review_note WHERE moderation_queue.id=q.id;
  END IF;
  RETURN QUERY SELECT q.id,q.content_type,q.content_id,exact_replay;
END;
$$;
REVOKE ALL ON FUNCTION public.moderate_content_atomic(uuid,uuid,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_content_atomic(uuid,uuid,text,text,text,timestamptz) TO service_role;


CREATE FUNCTION public.moderate_review_content_atomic(
  p_actor_id uuid, p_queue_id uuid, p_expected_status text,
  p_decision text, p_review_note text DEFAULT NULL, p_expected_reviewed_at timestamptz DEFAULT NULL, p_expected_content_hash text DEFAULT NULL
) RETURNS TABLE(id uuid, content_type text, content_id uuid, replayed boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE q public.moderation_queue%ROWTYPE; r public.facility_reviews%ROWTYPE;
  exact_replay boolean; locked_facility uuid;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected','escalated')
    OR p_expected_status IS NULL OR p_expected_status NOT IN ('pending','approved','rejected','escalated')
    OR p_expected_content_hash IS NULL OR p_expected_content_hash !~ '^[a-f0-9]{64}$'
    OR char_length(p_review_note) > 500 THEN RAISE EXCEPTION 'INVALID_MODERATION_INPUT'; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM 1 FROM public.profiles p WHERE p.id=p_actor_id AND p.is_platform_admin IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MODERATION_PERMISSION_REVOKED'; END IF;
  -- Review updates also update their facility's public rating via a trigger.
  -- Lock the parent before its queue/review rows, matching parent CASCADE and
  -- photo mutations. Recheck the content's facility after taking row locks.
  SELECT coalesce(m.facility_id,v.facility_id) INTO locked_facility
    FROM public.moderation_queue m LEFT JOIN public.facility_reviews v
      ON m.content_type='review' AND v.id=m.content_id WHERE m.id=p_queue_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF locked_facility IS NOT NULL THEN
    PERFORM 1 FROM public.facility_profiles p WHERE p.id=locked_facility FOR UPDATE;
  END IF;
  SELECT * INTO q FROM public.moderation_queue m WHERE m.id=p_queue_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF q.facility_id IS NOT NULL AND q.facility_id IS DISTINCT FROM locked_facility
    THEN RAISE EXCEPTION 'MODERATION_REVISION_CONFLICT'; END IF;
  IF q.content_type <> 'review' THEN RAISE EXCEPTION 'MODERATION_UNSUPPORTED_CONTENT'; END IF;
  SELECT * INTO r FROM public.facility_reviews v WHERE v.id=q.content_id FOR UPDATE;
  IF NOT FOUND OR r.facility_id IS DISTINCT FROM locked_facility
    OR (q.facility_id IS NOT NULL AND r.facility_id IS DISTINCT FROM q.facility_id)
    THEN RAISE EXCEPTION 'MODERATION_REVIEW_UNAVAILABLE'; END IF;
  IF public.review_content_hash(r) IS DISTINCT FROM p_expected_content_hash
    THEN RAISE EXCEPTION 'MODERATION_CONTENT_CHANGED'; END IF;
  exact_replay := q.status=p_decision AND q.review_note IS NOT DISTINCT FROM p_review_note
    AND q.reviewed_by IS NOT DISTINCT FROM p_actor_id;
  IF NOT exact_replay AND (q.status IS DISTINCT FROM p_expected_status
    OR q.reviewed_at IS DISTINCT FROM p_expected_reviewed_at)
    THEN RAISE EXCEPTION 'MODERATION_REVISION_CONFLICT'; END IF;
  IF p_decision='rejected' AND q.content_type='review' THEN
    SELECT * INTO r FROM public.facility_reviews v WHERE v.id=q.content_id FOR UPDATE;
    IF NOT FOUND OR r.facility_id IS DISTINCT FROM locked_facility
      OR (q.facility_id IS NOT NULL AND r.facility_id IS DISTINCT FROM q.facility_id)
      THEN RAISE EXCEPTION 'MODERATION_REVIEW_UNAVAILABLE'; END IF;
    UPDATE public.facility_reviews SET status='hidden',is_flagged=true,
      flag_reason=coalesce(nullif(p_review_note,''),'管理者による非承認') WHERE facility_reviews.id=r.id;
  END IF;
  IF p_decision='approved' THEN
    -- Release moderation flags without undoing the owner's independent hidden state.
    UPDATE public.facility_reviews SET is_flagged=false,flag_reason=NULL WHERE facility_reviews.id=r.id;
  END IF;
  IF NOT exact_replay THEN
    UPDATE public.moderation_queue SET status=p_decision,reviewed_by=p_actor_id,
      reviewed_at=clock_timestamp(),review_note=p_review_note WHERE moderation_queue.id=q.id;
  END IF;
  RETURN QUERY SELECT q.id,q.content_type,q.content_id,exact_replay;
END;
$$;
REVOKE ALL ON FUNCTION public.moderate_review_content_atomic(uuid,uuid,text,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_review_content_atomic(uuid,uuid,text,text,text,timestamptz,text) TO service_role;

COMMIT;

-- Detection evidence, flags and a pending review queue belong to one commit.
-- Reviewed unchanged detection evidence is not automatically replayed as a new
-- flag. A new IP group member or changed author/context can require a new review.
BEGIN;
ALTER TABLE public.moderation_queue ADD COLUMN flag_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK(jsonb_typeof(flag_evidence)='object');
CREATE FUNCTION public.moderation_review_context_hash(q public.moderation_queue,r public.facility_reviews)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('content',public.review_content_hash(r),
  'report_reason',q.report_reason,'reporter_id',q.reporter_id,'auto_flags',q.auto_flags,
  'flag_evidence',q.flag_evidence)::text,'UTF8')),'hex');
$$;
REVOKE ALL ON FUNCTION public.moderation_review_context_hash(public.moderation_queue,public.facility_reviews) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moderation_review_context_hash(public.moderation_queue,public.facility_reviews) TO service_role;
CREATE OR REPLACE FUNCTION public.moderation_review_snapshot(p_actor_id uuid,p_queue_id uuid)
RETURNS TABLE(snapshot jsonb) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE profiles.id=p_actor_id AND is_platform_admin IS TRUE)
    THEN RAISE EXCEPTION 'MODERATION_PERMISSION_REVOKED'; END IF;
  RETURN QUERY SELECT jsonb_build_object('id',q.id,'content_id',q.content_id,'content_type',q.content_type,
    'status',q.status,'reviewed_at',q.reviewed_at,'report_reason',q.report_reason,'auto_flags',coalesce(q.auto_flags,'[]'::jsonb),'content_hash',public.moderation_review_context_hash(q,r),
    'review',jsonb_build_object('comment',r.comment,'rating',r.rating,'photo_urls',r.photo_urls,
      'flag_reason',r.flag_reason,'rating_skill',r.rating_skill,'rating_service',r.rating_service,'rating_atmosphere',r.rating_atmosphere,
      'rating_cleanliness',r.rating_cleanliness,'rating_explanation',r.rating_explanation))
    FROM public.moderation_queue q JOIN public.facility_reviews r ON q.content_type='review' AND r.id=q.content_id
    WHERE q.id=p_queue_id AND (q.facility_id IS NULL OR q.facility_id=r.facility_id);
END;
$$;
REVOKE ALL ON FUNCTION public.moderation_review_snapshot(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moderation_review_snapshot(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.moderate_review_content_atomic(
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
  IF public.moderation_review_context_hash(q,r) IS DISTINCT FROM p_expected_content_hash
    THEN RAISE EXCEPTION 'MODERATION_CONTENT_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM public.moderation_queue newer WHERE newer.content_type='review'
    AND newer.content_id=q.content_id AND newer.status='pending' AND newer.id<>q.id)
    THEN RAISE EXCEPTION 'MODERATION_REVISION_CONFLICT'; END IF;
  -- A persisted approval released its flag. A new flag is a new moderation
  -- event, even before the legacy flagging worker finishes enqueueing it.
  IF q.status='approved' AND q.decision_content_hash IS NOT NULL AND r.is_flagged IS TRUE
    THEN RAISE EXCEPTION 'MODERATION_REVISION_CONFLICT'; END IF;
  exact_replay := q.status=p_decision AND q.review_note IS NOT DISTINCT FROM p_review_note
    AND q.reviewed_by IS NOT DISTINCT FROM p_actor_id
    AND q.decision_content_hash IS NOT DISTINCT FROM p_expected_content_hash;
  IF NOT exact_replay AND (q.status IS DISTINCT FROM p_expected_status
    OR q.reviewed_at IS DISTINCT FROM p_expected_reviewed_at)
    THEN RAISE EXCEPTION 'MODERATION_REVISION_CONFLICT'; END IF;
  IF NOT exact_replay AND p_decision='rejected' AND q.content_type='review' THEN
    SELECT * INTO r FROM public.facility_reviews v WHERE v.id=q.content_id FOR UPDATE;
    IF NOT FOUND OR r.facility_id IS DISTINCT FROM locked_facility
      OR (q.facility_id IS NOT NULL AND r.facility_id IS DISTINCT FROM q.facility_id)
      THEN RAISE EXCEPTION 'MODERATION_REVIEW_UNAVAILABLE'; END IF;
    UPDATE public.facility_reviews SET status='hidden',is_flagged=true,
      flag_reason=coalesce(nullif(p_review_note,''),'管理者による非承認') WHERE facility_reviews.id=r.id;
  END IF;
  IF NOT exact_replay AND p_decision='approved' THEN
    -- Release moderation flags without undoing the owner's independent hidden state.
    UPDATE public.facility_reviews SET is_flagged=false,flag_reason=NULL WHERE facility_reviews.id=r.id;
  END IF;
  IF NOT exact_replay THEN
    UPDATE public.moderation_queue SET status=p_decision,reviewed_by=p_actor_id,
      reviewed_at=clock_timestamp(),review_note=p_review_note,decision_content_hash=p_expected_content_hash WHERE moderation_queue.id=q.id;
  END IF;
  RETURN QUERY SELECT q.id,q.content_type,q.content_id,exact_replay;
END;
$$;
REVOKE ALL ON FUNCTION public.moderate_review_content_atomic(uuid,uuid,text,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_review_content_atomic(uuid,uuid,text,text,text,timestamptz,text) TO service_role;


CREATE FUNCTION public.flag_review_group_atomic(p_items jsonb,p_flag_type text)
RETURNS TABLE(id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ids uuid[]; group_ids uuid[]; ip text; facility uuid; ip_count integer; facility_count integer;
 n bigint; since_time timestamptz; evidence text; reason text; r public.facility_reviews%ROWTYPE;
BEGIN
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR p_flag_type IS NULL
  OR p_flag_type NOT IN ('bulk_submission','duplicate_facility') OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
     OR x->>'id' IS NULL OR x->>'facility_id' IS NULL
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('id','facility_id')))
 THEN RAISE EXCEPTION 'INVALID_REVIEW_FLAG_INPUT'; END IF;
 SELECT array_agg(DISTINCT v.id),count(DISTINCT v.reviewer_ip),min(v.reviewer_ip),
   count(DISTINCT v.facility_id),min(v.facility_id::text)::uuid
  INTO ids,ip_count,ip,facility_count,facility
  FROM public.facility_reviews v JOIN jsonb_to_recordset(p_items) x(id uuid,facility_id uuid)
   ON x.id=v.id AND x.facility_id=v.facility_id;
 IF ids IS NULL THEN RETURN; END IF;
 IF ip_count<>1 OR ip IS NULL OR (p_flag_type='duplicate_facility' AND facility_count<>1)
  THEN RAISE EXCEPTION 'INVALID_REVIEW_FLAG_GROUP'; END IF;
 SELECT array_agg(v.id) INTO group_ids FROM public.facility_reviews v WHERE v.reviewer_ip=ip
  AND (CASE WHEN p_flag_type='bulk_submission' THEN v.created_at>=clock_timestamp()-interval '24 hours'
    ELSE v.facility_id=facility AND v.status='published' END);
 -- Same parent -> queue -> review order as editing and moderation.
 PERFORM 1 FROM public.facility_profiles p WHERE p.id IN(
  SELECT v.facility_id FROM public.facility_reviews v WHERE v.id=ANY(group_ids)) ORDER BY p.id FOR UPDATE;
 PERFORM 1 FROM public.moderation_queue q WHERE q.content_type='review' AND q.content_id=ANY(group_ids) ORDER BY q.id FOR UPDATE;
 PERFORM 1 FROM public.facility_reviews v WHERE v.id=ANY(group_ids) ORDER BY v.id FOR UPDATE;
 since_time:=clock_timestamp()-interval '24 hours';
 IF p_flag_type='bulk_submission' THEN
  SELECT count(*),encode(sha256(convert_to(jsonb_build_object('rule',p_flag_type,'ip',ip,
   'reviews',jsonb_agg(v.id ORDER BY v.id))::text,'UTF8')),'hex') INTO n,evidence
   FROM public.facility_reviews v WHERE v.reviewer_ip=ip AND v.created_at>=since_time;
  IF n<3 THEN RETURN; END IF;
  reason:='bulk_submission: '||n||' reviews in 24h from same IP';
 ELSE
  SELECT count(*) FILTER(WHERE v.is_flagged IS FALSE),
   encode(sha256(convert_to(jsonb_build_object('rule',p_flag_type,'ip',ip,'facility',facility,
    'reviews',jsonb_agg(v.id ORDER BY v.id))::text,'UTF8')),'hex') INTO n,evidence
   FROM public.facility_reviews v WHERE v.reviewer_ip=ip AND v.facility_id=facility AND v.status='published';
  IF n<2 THEN RETURN; END IF;
  reason:='duplicate_facility: '||n||' unflagged reviews from same IP for same facility';
 END IF;
 -- Refresh pending detection context for this locked group, including already
 -- flagged rows. A moderator who saw the earlier evidence must read it again.
 IF EXISTS(SELECT 1 FROM public.moderation_queue q WHERE q.content_type='review' AND q.content_id=ANY(group_ids)
  AND q.status='pending' AND q.auto_flags IS NOT NULL AND jsonb_typeof(q.auto_flags)<>'array')
  THEN RAISE EXCEPTION 'INVALID_MODERATION_FLAGS'; END IF;
 UPDATE public.moderation_queue SET flag_evidence=flag_evidence||jsonb_build_object(p_flag_type,evidence),
  auto_flags=(SELECT jsonb_agg(DISTINCT f) FROM jsonb_array_elements(coalesce(auto_flags,'[]'::jsonb)||jsonb_build_array(p_flag_type)) f),
  report_reason=CASE WHEN reporter_id IS NULL AND (report_reason LIKE 'bulk_submission:%' OR report_reason LIKE 'duplicate_facility:%') THEN reason ELSE report_reason END
  WHERE content_type='review' AND content_id=ANY(group_ids) AND status='pending';
 FOR r IN SELECT v.* FROM public.facility_reviews v WHERE v.id=ANY(ids) AND v.reviewer_ip=ip
   AND v.is_flagged IS FALSE AND (CASE WHEN p_flag_type='bulk_submission' THEN v.created_at>=since_time
     ELSE v.facility_id=facility AND v.status='published' END) ORDER BY v.id LOOP
  IF EXISTS(SELECT 1 FROM public.moderation_queue approved WHERE approved.content_type='review'
   AND approved.content_id=r.id AND approved.status='approved'
   AND approved.flag_evidence->>p_flag_type=evidence
   AND approved.decision_content_hash=public.moderation_review_context_hash(approved,r)) THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM public.moderation_queue q WHERE q.content_type='review' AND q.content_id=r.id
   AND q.status='pending' AND q.auto_flags IS NOT NULL AND jsonb_typeof(q.auto_flags)<>'array')
   THEN RAISE EXCEPTION 'INVALID_MODERATION_FLAGS'; END IF;
  INSERT INTO public.moderation_queue(content_type,content_id,facility_id,report_reason,auto_flags,flag_evidence,status)
   VALUES('review',r.id,r.facility_id,reason,jsonb_build_array(p_flag_type),jsonb_build_object(p_flag_type,evidence),'pending')
   ON CONFLICT(content_type,content_id) WHERE status='pending' DO UPDATE
    SET flag_evidence=moderation_queue.flag_evidence||EXCLUDED.flag_evidence,
      auto_flags=(SELECT jsonb_agg(DISTINCT f) FROM jsonb_array_elements(coalesce(moderation_queue.auto_flags,'[]'::jsonb)||EXCLUDED.auto_flags) f);
  -- Existing human report reason/reporter and previous auto flags are preserved.
  UPDATE public.facility_reviews SET is_flagged=true,flag_reason=reason WHERE facility_reviews.id=r.id;
  RETURN QUERY SELECT r.id;
 END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.flag_review_group_atomic(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.flag_review_group_atomic(jsonb,text) TO service_role;
COMMIT;

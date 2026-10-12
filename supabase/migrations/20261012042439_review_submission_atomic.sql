-- Review content writes pass the server API. Point credit and moderation enqueue
-- belong to the same transaction as the review, including legacy consumers.
BEGIN;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.facility_reviews FROM PUBLIC, anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.facility_reviews TO service_role;
-- Keep the existing owner/admin visibility control, without content editing.
GRANT UPDATE(status) ON public.facility_reviews TO authenticated;

CREATE FUNCTION public.lock_review_submission() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN PERFORM public.lock_booking_account(NEW.user_id); END IF;
  PERFORM 1 FROM public.facility_profiles WHERE id=NEW.facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_FACILITY_UNAVAILABLE'; END IF;
  IF nullif(NEW.reviewer_ip,'') IS NOT NULL
    AND NEW.created_at >= clock_timestamp()-interval '24 hours'
    AND EXISTS(SELECT 1 FROM public.facility_reviews r WHERE r.facility_id=NEW.facility_id
      AND r.reviewer_ip=NEW.reviewer_ip AND r.created_at >= clock_timestamp()-interval '24 hours')
    THEN RAISE EXCEPTION 'REVIEW_RECENT_DUPLICATE'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_review_submission() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER aa_lock_review_submission BEFORE INSERT ON public.facility_reviews
  FOR EACH ROW EXECUTE FUNCTION public.lock_review_submission();

CREATE FUNCTION public.commit_review_effects() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.user_id IS NOT NULL AND NEW.is_verified_visit IS TRUE THEN
    INSERT INTO public.user_points(user_id,points,reason)
      VALUES(NEW.user_id,50,'口コミポイント:'||NEW.facility_id::text)
      ON CONFLICT(user_id,reason) WHERE reason LIKE '口コミポイント:%' DO NOTHING;
  END IF;
  -- A moderator rejection changes the flag, not the authored content. Preserve
  -- its report metadata and do not manufacture another pending decision.
  IF NEW.is_flagged IS TRUE AND (TG_OP='INSERT' OR NEW.comment IS DISTINCT FROM OLD.comment) THEN
    INSERT INTO public.moderation_queue(content_type,content_id,facility_id,report_reason,auto_flags,status)
      VALUES('review',NEW.id,NEW.facility_id,coalesce(NEW.flag_reason,'口コミの内容を確認してください'),
        CASE WHEN TG_OP='INSERT' THEN '["medical_ad"]'::jsonb ELSE '["content_changed"]'::jsonb END,'pending')
      ON CONFLICT(content_type,content_id) WHERE status='pending'
      DO UPDATE SET report_reason=EXCLUDED.report_reason,auto_flags=EXCLUDED.auto_flags;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_review_effects() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_review_atomic_effects AFTER INSERT OR UPDATE OF comment,is_flagged ON public.facility_reviews
  FOR EACH ROW EXECUTE FUNCTION public.commit_review_effects();

-- Use the same parent -> queue -> review lock order as moderation decisions.
-- The actor is verified by the API and rechecked against the stored owner here.
CREATE FUNCTION public.edit_review_atomic(p_actor_id uuid,p_review_id uuid,p_patch jsonb)
RETURNS TABLE(id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE facility uuid; r public.facility_reviews%ROWTYPE; n public.facility_reviews%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k
    WHERE k <> ALL(ARRAY['rating_skill','rating_service','rating_atmosphere','rating_cleanliness',
      'rating_explanation','comment','is_flagged','flag_reason'])) THEN RAISE EXCEPTION 'INVALID_REVIEW_PATCH'; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  SELECT v.facility_id INTO facility FROM public.facility_reviews v WHERE v.id=p_review_id AND v.user_id=p_actor_id;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM public.facility_profiles WHERE facility_profiles.id=facility FOR UPDATE;
  PERFORM 1 FROM public.moderation_queue q WHERE q.content_type='review' AND q.content_id=p_review_id ORDER BY q.id FOR UPDATE;
  SELECT v.* INTO r FROM public.facility_reviews v WHERE v.id=p_review_id AND v.user_id=p_actor_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.facility_id IS DISTINCT FROM facility THEN RAISE EXCEPTION 'REVIEW_REVISION_CONFLICT'; END IF;
  n := jsonb_populate_record(r,p_patch);
  IF n.rating_skill NOT BETWEEN 1 AND 5 OR n.rating_service NOT BETWEEN 1 AND 5
    OR n.rating_atmosphere NOT BETWEEN 1 AND 5 OR n.rating_cleanliness NOT BETWEEN 1 AND 5
    OR n.rating_explanation NOT BETWEEN 1 AND 5 OR n.rating_skill IS NULL OR n.rating_service IS NULL
    OR n.rating_atmosphere IS NULL OR n.rating_cleanliness IS NULL OR n.rating_explanation IS NULL
    OR char_length(n.comment)>500 OR (p_patch ? 'is_flagged' AND n.is_flagged IS DISTINCT FROM true)
    THEN RAISE EXCEPTION 'INVALID_REVIEW_PATCH'; END IF;
  RETURN QUERY UPDATE public.facility_reviews v SET
    rating=round((n.rating_skill+n.rating_service+n.rating_atmosphere+n.rating_cleanliness+n.rating_explanation)/5.0),
    rating_skill=n.rating_skill,rating_service=n.rating_service,rating_atmosphere=n.rating_atmosphere,
    rating_cleanliness=n.rating_cleanliness,rating_explanation=n.rating_explanation,comment=n.comment,
    is_flagged=n.is_flagged,flag_reason=n.flag_reason
    WHERE v.id=p_review_id AND v.user_id=p_actor_id RETURNING v.id;
END;
$$;
REVOKE ALL ON FUNCTION public.edit_review_atomic(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_review_atomic(uuid,uuid,jsonb) TO service_role;
COMMIT;

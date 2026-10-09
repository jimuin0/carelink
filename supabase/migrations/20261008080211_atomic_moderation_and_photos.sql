-- R08: moderation decisions and rejected-review visibility commit together.
-- Every public RPC is SECURITY INVOKER and service-role only. The verified
-- actor's authority is checked again under a row lock inside the transaction.
-- Browser reads use the same platform-admin authority as the API. Legacy
-- role='admin' and direct Data API writes cannot bypass atomic review hiding.
DROP POLICY IF EXISTS moderation_admin_all ON public.moderation_queue;
CREATE POLICY moderation_platform_admin_read ON public.moderation_queue FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_platform_admin IS TRUE));
REVOKE ALL ON public.moderation_queue FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.moderation_queue TO authenticated;

CREATE FUNCTION public.moderate_content_atomic(
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

-- R10: new deletion and main-photo designation use the same lock order:
-- actor account -> profile -> membership -> photo. Account deletion cannot
-- hold a membership while this writer holds its facility lock. The photo is
-- selected inside that transaction,
-- never converted to a URL by an earlier unlocked application-side read.
CREATE FUNCTION public.set_facility_main_photo_atomic(p_actor_id uuid,p_facility_id uuid,p_photo_id uuid)
RETURNS TABLE(id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE url text;
BEGIN
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM 1 FROM public.facility_profiles p WHERE p.id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM public.facility_members m WHERE m.facility_id=p_facility_id AND m.user_id=p_actor_id
    AND m.role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_PERMISSION_REVOKED'; END IF;
  SELECT p.photo_url INTO url FROM public.facility_photos p WHERE p.id=p_photo_id
    AND p.facility_id=p_facility_id FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY UPDATE public.facility_profiles p SET main_photo_url=url,updated_at=clock_timestamp()
    WHERE p.id=p_facility_id RETURNING p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_facility_main_photo_atomic(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_facility_main_photo_atomic(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.delete_facility_photo_atomic(p_actor_id uuid,p_facility_id uuid,p_photo_id uuid)
RETURNS TABLE(id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM 1 FROM public.facility_profiles p WHERE p.id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM public.facility_members m WHERE m.facility_id=p_facility_id AND m.user_id=p_actor_id
    AND m.role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_PERMISSION_REVOKED'; END IF;
  -- Listing publication remains separate from booking preparation. Deleting
  -- the last photo does not silently change publication; booking readiness
  -- requires a remaining photo and the authoritative booking RPC rechecks it.
  RETURN QUERY DELETE FROM public.facility_photos p WHERE p.id=p_photo_id AND p.facility_id=p_facility_id RETURNING p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_facility_photo_atomic(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_facility_photo_atomic(uuid,uuid,uuid) TO service_role;

-- A narrow trigger is also a backstop for server-maintenance/cascade deletion
-- and authorized URL/membership edits. It never deletes a Storage object,
-- changes listing status or clears a different/new main URL. SECURITY DEFINER
-- is necessary only for this fixed OLD-row update: browser photo UPDATE rights
-- do not authorize arbitrary facility-profile UPDATE. No role may invoke it.
CREATE FUNCTION public.clear_removed_facility_main_photo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.photo_url IS DISTINCT FROM OLD.photo_url
    OR NEW.facility_id IS DISTINCT FROM OLD.facility_id THEN
    -- Lock first, then inspect remaining references in a fresh statement.
    -- Otherwise two direct server deletes can each see the other's pending
    -- duplicate URL and both leave a dangling main URL at commit.
    PERFORM 1 FROM public.facility_profiles WHERE id=OLD.facility_id FOR UPDATE;
    UPDATE public.facility_profiles SET main_photo_url=NULL,updated_at=clock_timestamp()
      WHERE facility_profiles.id=OLD.facility_id AND main_photo_url=OLD.photo_url
        AND NOT EXISTS(SELECT 1 FROM public.facility_photos p WHERE p.facility_id=OLD.facility_id AND p.photo_url=OLD.photo_url);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_removed_facility_main_photo() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER clear_removed_facility_main_photo AFTER DELETE OR UPDATE OF photo_url,facility_id ON public.facility_photos
  FOR EACH ROW EXECUTE FUNCTION public.clear_removed_facility_main_photo();

-- Direct browser DELETE uses row -> profile trigger locks and cannot guarantee
-- the same lock order as booking/main designation. New UI uses the API/RPC;
-- old tabs receive a visible permission failure and must reload. Read/INSERT/
-- UPDATE ownership policies and Storage registration forms are unchanged.
REVOKE DELETE ON public.facility_photos FROM authenticated;

-- All main-photo writes must identify an existing same-facility photo.
-- The generic settings RPC can no longer bypass the dedicated photo RPC.
CREATE OR REPLACE FUNCTION public.update_facility_settings_atomic(p_actor_id uuid, p_facility_id uuid, p_patch jsonb)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE f public.facility_profiles%ROWTYPE; n public.facility_profiles%ROWTYPE; assignments text;
BEGIN
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch='{}'::jsonb OR EXISTS(
    SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k <> ALL(ARRAY[
      'name','business_type','catch_copy','description','postal_code','prefecture','city','address','building',
      'access_info','nearest_station','phone','website_url','seat_count','staff_count','parking','credit_card',
      'features','regular_holiday','business_hours','booking_auto_confirm','booking_buffer_minutes',
      'board_slot_minutes','status','updated_at'])) THEN RAISE EXCEPTION 'INVALID_FACILITY_PATCH'; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  SELECT * INTO f FROM public.facility_profiles p WHERE p.id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.facility_members m WHERE m.facility_id=p_facility_id AND m.user_id=p_actor_id
    AND m.role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_PERMISSION_REVOKED'; END IF;
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

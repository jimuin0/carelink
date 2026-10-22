-- Free listing (掲載公開) now requires confirmed business hours (2026-10-23).
--
-- 神原さん (2026-10-23): 営業時間（曜日別の営業時間・定休日の保存）を「無料掲載に必要」な条件に入れる。
--
-- Before: publishing checked only the owner, the name and the location. Online
-- booking already required public.confirmed_booking_hours (all seven days
-- saved, at least one open day, open < close), so a shop could be listed with
-- no business hours at all.
--
-- After: the two RPCs that publish a facility refuse with
--   check_violation, MESSAGE '"published_facility_hours_confirmed"'
-- (src/lib/facility-publish-gate.ts isPublishedHoursConflict maps it to 409)
-- when the resulting row is published and confirmed_booking_hours() is false,
-- but ONLY when the write is a publish (the row was not already published) or
-- it changes business_hours of a published row. Unrelated saves of an already
-- published row (name, phone, status re-sent as published, ...) are not
-- re-validated, so a legacy published row without confirmed hours is never
-- unpublished or locked by this migration. Production (2026-10-23): the 3
-- published facilities all have confirmed hours.
--
-- The application gate (listingPublishMissing / checkPublishReadiness, used by
-- /api/admin/settings ?action=status and /api/admin/chain/bulk-publish) checks
-- the same rule first; this is the final check under the row lock.
--
-- Not a CHECK constraint on purpose: a constraint is re-evaluated on every
-- UPDATE of the row (and would also have to be validated against existing
-- rows), which is exactly the re-validation of unrelated updates we avoid.
-- Direct table writes are service_role only (authenticated has no UPDATE
-- policy on facility_profiles), and no application path publishes outside
-- these two RPCs.
--
-- Both functions are copies of their latest definitions with only the lines
-- marked "published_facility_hours_confirmed" added:
--   * update_facility_settings_atomic    — 20261008080211_atomic_moderation_and_photos.sql
--   * set_facilities_publication_atomic  — 20261002012217_booking_transition_outbox_and_publish_authorization.sql
-- No later migration or DO block redefines either. Signatures, SECURITY
-- INVOKER and search_path are unchanged; REVOKE / GRANT are restated.
--
-- Apply order: after 20261002012045 (public.confirmed_booking_hours),
-- 20261002012217, 20261008080211 and every migration up to
-- 20261023164100_customer_change_closes_with_free_cancel_window.sql.
-- Safe to apply before or after the application deploy. The new application
-- checks the same rule before calling these RPCs and maps the code to 409.
-- Until it is deployed, the old build does not know the rule: a publish it
-- attempts for a facility without confirmed hours is refused here and shown as
-- a generic failure (500 /「公開に失敗しました」); nothing is written.
-- No data rewrite; existing published rows are not touched.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

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
  PERFORM 1 FROM public.facility_profiles p WHERE p.id=p_facility_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.facility_members m WHERE m.facility_id=p_facility_id AND m.user_id=p_actor_id
    AND m.role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACILITY_PERMISSION_REVOKED'; END IF;
  SELECT * INTO f FROM public.facility_profiles p WHERE p.id=p_facility_id FOR NO KEY UPDATE;
  n := jsonb_populate_record(f,p_patch);
  IF n.status='published' AND NOT EXISTS(SELECT 1 FROM public.facility_members
    WHERE facility_id=p_facility_id AND role='owner') THEN RAISE EXCEPTION 'FACILITY_OWNER_REQUIRED'; END IF;
  IF n.status='published' AND (n.name IS NULL OR n.prefecture IS NULL OR n.city IS NULL OR n.address IS NULL
    OR n.name !~ '[^[:space:]　]' OR n.prefecture !~ '[^[:space:]　]' OR n.city !~ '[^[:space:]　]' OR n.address !~ '[^[:space:]　]')
    THEN RAISE check_violation USING MESSAGE='"published_facility_location_present"'; END IF;
  -- published_facility_hours_confirmed: a publish, or a change of a published row's hours, needs confirmed hours.
  IF n.status='published'
    AND (f.status IS DISTINCT FROM 'published' OR n.business_hours IS DISTINCT FROM f.business_hours)
    AND NOT public.confirmed_booking_hours(n.business_hours)
    THEN RAISE check_violation USING MESSAGE='"published_facility_hours_confirmed"'; END IF;
  SELECT string_agg(format('%I=x.%I',k,k),',') INTO assignments FROM jsonb_object_keys(p_patch) k WHERE k <> 'updated_at';
  IF assignments IS NULL THEN RAISE EXCEPTION 'INVALID_FACILITY_PATCH'; END IF;
  RETURN QUERY EXECUTE format('UPDATE public.facility_profiles p SET %s,updated_at=clock_timestamp()
    FROM jsonb_populate_record(NULL::public.facility_profiles,$2) x WHERE p.id=$1 RETURNING p.id',assignments)
    USING p_facility_id,to_jsonb(n);
END;
$$;
REVOKE ALL ON FUNCTION public.update_facility_settings_atomic(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_facility_settings_atomic(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.set_facilities_publication_atomic(
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
    -- published_facility_hours_confirmed: only a publish is checked; an already published row is left as is.
    IF p_is_published AND f.status IS DISTINCT FROM 'published'
      AND NOT public.confirmed_booking_hours(f.business_hours)
    THEN RAISE check_violation USING MESSAGE = '"published_facility_hours_confirmed"'; END IF;
  END LOOP;
  RETURN QUERY UPDATE public.facility_profiles p SET
    status = CASE WHEN p_is_published THEN 'published' ELSE 'draft' END,
    updated_at = clock_timestamp() WHERE p.id = ANY(p_facility_ids) RETURNING p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_facilities_publication_atomic(uuid,uuid[],boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_facilities_publication_atomic(uuid,uuid[],boolean) TO service_role;

-- Keep existing publication/deletion policy. Authorization and final mutation
-- share one transaction; no production data is rewritten by this migration.
CREATE FUNCTION public.read_admin_menu_snapshot(p_actor_id uuid,p_facility_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.facility_members m WHERE m.user_id=p_actor_id AND m.facility_id=p_facility_id AND m.role IN ('owner','admin')) THEN
  RAISE EXCEPTION 'MENU_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('revision',f.updated_at,'menus',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.sort_order,m.id)
  FROM public.facility_menus m WHERE m.facility_id=f.id),'[]'::jsonb)) INTO result FROM public.facility_profiles f WHERE f.id=p_facility_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_FACILITY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.delete_admin_menu_atomic(p_actor_id uuid,p_facility_id uuid,p_menu_id uuid)
RETURNS TABLE(id uuid,facility_id uuid,outcome text) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE f public.facility_profiles%ROWTYPE;
BEGIN
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_members m WHERE m.user_id=p_actor_id AND m.facility_id=p_facility_id AND m.role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.facility_profiles p WHERE p.id=p_facility_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_FACILITY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF f.status IS NULL OR f.status NOT IN ('draft','published','suspended') THEN RAISE EXCEPTION 'MENU_PUBLICATION_UNKNOWN' USING ERRCODE='22023'; END IF;
 PERFORM m.id FROM public.facility_menus m WHERE m.id=p_menu_id AND m.facility_id=p_facility_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF f.status='published' AND (SELECT count(*) FROM public.facility_menus m WHERE m.facility_id=p_facility_id)<=1 THEN
  RETURN QUERY SELECT p_menu_id,p_facility_id,'last_menu'::text; RETURN; END IF;
 DELETE FROM public.facility_menus m WHERE m.id=p_menu_id AND m.facility_id=p_facility_id;
 UPDATE public.facility_profiles p SET updated_at=greatest(clock_timestamp(),COALESCE(p.updated_at,'-infinity'::timestamptz)+interval '1 microsecond') WHERE p.id=p_facility_id;
 RETURN QUERY SELECT p_menu_id,p_facility_id,'deleted'::text;
END $$;

CREATE FUNCTION public.reorder_admin_menus_atomic(p_actor_id uuid,p_facility_id uuid,p_menu_ids uuid[],p_expected_ids uuid[],p_expected_revision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE f public.facility_profiles%ROWTYPE; category_name text; actual uuid[]; revision timestamptz;
BEGIN
 IF cardinality(p_menu_ids) NOT BETWEEN 2 AND 5000 OR p_menu_ids IS NULL OR p_expected_ids IS NULL
  OR cardinality(p_menu_ids)<>cardinality(p_expected_ids)
  OR EXISTS(SELECT 1 FROM unnest(p_menu_ids) x WHERE x IS NULL)
  OR EXISTS(SELECT 1 FROM unnest(p_expected_ids) x WHERE x IS NULL)
  OR (SELECT count(DISTINCT x) FROM unnest(p_menu_ids) x)<>cardinality(p_menu_ids)
  OR (SELECT array_agg(x ORDER BY x) FROM unnest(p_menu_ids) x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p_expected_ids) x)
 THEN RAISE EXCEPTION 'INVALID_MENU_ORDER' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_members m WHERE m.user_id=p_actor_id AND m.facility_id=p_facility_id AND m.role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.facility_profiles p WHERE p.id=p_facility_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_FACILITY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF f.updated_at IS DISTINCT FROM NULLIF(p_expected_revision,'')::timestamptz THEN RAISE EXCEPTION 'MENU_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 -- Lock IDs in a stable order; inserts/reassignments take the parent FK lock.
 PERFORM m.id FROM public.facility_menus m WHERE m.facility_id=p_facility_id ORDER BY m.id FOR UPDATE;
 SELECT m.category INTO category_name FROM public.facility_menus m WHERE m.id=p_menu_ids[1] AND m.facility_id=p_facility_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT array_agg(m.id ORDER BY m.sort_order,m.id) INTO actual FROM public.facility_menus m WHERE m.facility_id=p_facility_id AND m.category=category_name;
 IF actual IS DISTINCT FROM p_expected_ids THEN RAISE EXCEPTION 'MENU_ORDER_CONFLICT' USING ERRCODE='40001'; END IF;
 -- One statement: a trigger/constraint failure restores every position.
 UPDATE public.facility_menus m SET sort_order=(o.position-1)::integer
 FROM unnest(p_menu_ids) WITH ORDINALITY o(menu_id,position) WHERE m.id=o.menu_id AND m.facility_id=p_facility_id;
 UPDATE public.facility_profiles p SET updated_at=greatest(clock_timestamp(),COALESCE(p.updated_at,'-infinity'::timestamptz)+interval '1 microsecond') WHERE p.id=p_facility_id RETURNING p.updated_at INTO revision;
 RETURN jsonb_build_object('outcome','saved','facility_id',p_facility_id,'revision',revision);
END $$;
REVOKE ALL ON FUNCTION public.read_admin_menu_snapshot(uuid,uuid),public.delete_admin_menu_atomic(uuid,uuid,uuid),public.reorder_admin_menus_atomic(uuid,uuid,uuid[],uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_admin_menu_snapshot(uuid,uuid),public.delete_admin_menu_atomic(uuid,uuid,uuid),public.reorder_admin_menus_atomic(uuid,uuid,uuid[],uuid[],text) TO service_role;

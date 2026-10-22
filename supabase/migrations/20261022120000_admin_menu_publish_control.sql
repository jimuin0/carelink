-- Let a shop publish or unpublish a menu from /admin/menus.
--
-- HPB bulk import creates menus as drafts (is_published=false), but the only
-- menu write path (this RPC) did not accept is_published, so an imported menu
-- could never be published and the shop could never take online bookings.
--
-- Changes from 20261017125640_menu_write_authority_atomic.sql (latest
-- definition), and nothing else:
--   * is_published is an allowed key and must be a JSON boolean when sent;
--   * UPDATE writes it from jsonb_populate_record(current_menu, ...), so an
--     edit that does not send it keeps the current value (partial update);
--   * INSERT defaults it to true, matching the column default, so a menu the
--     owner adds by hand stays visible as before.
-- Authorization, lock order, photo check and receipt shape are unchanged.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.save_admin_menu_atomic(
 p_actor_id uuid,p_facility_id uuid,p_menu_id uuid,p_values jsonb,
 p_check_photo boolean,p_expected_photo text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current_menu public.facility_menus%ROWTYPE;
 result_menu public.facility_menus%ROWTYPE; values_menu public.facility_menus%ROWTYPE;
 position integer;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL THEN
  RAISE EXCEPTION 'MENU_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p_values IS NULL OR jsonb_typeof(p_values)<>'object' OR p_values='{}'::jsonb
  OR p_check_photo IS NULL
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN
   ('category','name','description','price','price_note','duration_minutes','photo_url','is_featured','is_published','sort_order'))
  OR (p_values ? 'is_published' AND jsonb_typeof(p_values->'is_published')<>'boolean')
  OR (p_menu_id IS NOT NULL AND p_values ? 'sort_order')
 THEN RAISE EXCEPTION 'INVALID_MENU_MUTATION' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_members m WHERE m.user_id=p_actor_id AND m.facility_id=p_facility_id
  AND m.role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.facility_profiles f WHERE f.id=p_facility_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_FACILITY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF p_menu_id IS NOT NULL THEN
  SELECT * INTO current_menu FROM public.facility_menus m WHERE m.id=p_menu_id AND m.facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MENU_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  -- A legacy stock-image exemption is valid only for the value observed by
  -- the server guard; a concurrent removal/replacement invalidates it.
  IF p_check_photo AND current_menu.photo_url IS DISTINCT FROM p_expected_photo THEN
   RAISE EXCEPTION 'MENU_PHOTO_CONFLICT' USING ERRCODE='40001'; END IF;
  SELECT * INTO values_menu FROM jsonb_populate_record(current_menu,p_values);
 ELSE
  IF p_check_photo THEN RAISE EXCEPTION 'INVALID_MENU_MUTATION' USING ERRCODE='22023'; END IF;
  SELECT * INTO values_menu FROM jsonb_populate_record(NULL::public.facility_menus,p_values);
 END IF;
 IF values_menu.name IS NULL OR char_length(values_menu.name) NOT BETWEEN 1 AND 100
  OR values_menu.category IS NULL OR char_length(values_menu.category) NOT BETWEEN 1 AND 50
 THEN RAISE EXCEPTION 'INVALID_MENU_MUTATION' USING ERRCODE='22023'; END IF;
 IF p_menu_id IS NULL THEN
  SELECT count(*)::integer INTO position FROM public.facility_menus WHERE facility_id=p_facility_id;
  INSERT INTO public.facility_menus(facility_id,category,name,description,price,price_note,duration_minutes,photo_url,is_featured,is_published,sort_order)
   VALUES(p_facility_id,values_menu.category,values_menu.name,values_menu.description,values_menu.price,values_menu.price_note,
    values_menu.duration_minutes,NULLIF(values_menu.photo_url,''),COALESCE(values_menu.is_featured,false),
    COALESCE(values_menu.is_published,true),COALESCE(values_menu.sort_order,position))
   RETURNING * INTO result_menu;
 ELSE
  UPDATE public.facility_menus m SET category=values_menu.category,name=values_menu.name,description=values_menu.description,
   price=values_menu.price,price_note=values_menu.price_note,duration_minutes=values_menu.duration_minutes,
   photo_url=NULLIF(values_menu.photo_url,''),is_featured=values_menu.is_featured,
   is_published=values_menu.is_published
   WHERE m.id=p_menu_id AND m.facility_id=p_facility_id RETURNING * INTO result_menu;
 END IF;
 UPDATE public.facility_profiles f SET updated_at=greatest(clock_timestamp(),COALESCE(f.updated_at,'-infinity'::timestamptz)+interval '1 microsecond') WHERE f.id=p_facility_id;
 RETURN to_jsonb(result_menu);
END $$;
REVOKE ALL ON FUNCTION public.save_admin_menu_atomic(uuid,uuid,uuid,jsonb,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_admin_menu_atomic(uuid,uuid,uuid,jsonb,boolean,text) TO service_role;

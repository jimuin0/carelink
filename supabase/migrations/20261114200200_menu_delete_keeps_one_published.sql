-- 点検 A411（2026年11月14日）：公開施設で「表示中」のメニューを最後の 1 件まで削除できてしまう不具合を直す。
--
-- delete_admin_menu_atomic は施設のメニュー総数（下書きを含む）が 1 件以下のときだけ 'last_menu' で止めていた。
-- HPB 取り込みの下書き（is_published=false）が残っていると、表示中の 1 件を削除でき、公開中なのに表示メニュー 0 件になった。
-- 非公開化は save_admin_menu_atomic が MENU_LAST_PUBLISHED で止めている（20261022120000:65-68）ので、同じ判定にそろえる：
-- 消すメニューが表示中で、ほかに表示中のメニューが無ければ 'last_menu'。下書きの削除は止めない。
-- 写し元: 20261015133116_menu_delete_and_reorder_atomic.sql（全文。上記の判定だけを置換）。CREATE OR REPLACE は既存の GRANT を保つ。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.delete_admin_menu_atomic(p_actor_id uuid,p_facility_id uuid,p_menu_id uuid)
RETURNS TABLE(id uuid,facility_id uuid,outcome text) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE f public.facility_profiles%ROWTYPE; target_published boolean;
BEGIN
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_members m WHERE m.user_id=p_actor_id AND m.facility_id=p_facility_id AND m.role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.facility_profiles p WHERE p.id=p_facility_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_FACILITY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF f.status IS NULL OR f.status NOT IN ('draft','published','suspended') THEN RAISE EXCEPTION 'MENU_PUBLICATION_UNKNOWN' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(m.is_published,true) INTO target_published FROM public.facility_menus m WHERE m.id=p_menu_id AND m.facility_id=p_facility_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF f.status='published' AND target_published AND NOT EXISTS(SELECT 1 FROM public.facility_menus m
   WHERE m.facility_id=p_facility_id AND m.id<>p_menu_id AND COALESCE(m.is_published,true)) THEN
  RETURN QUERY SELECT p_menu_id,p_facility_id,'last_menu'::text; RETURN; END IF;
 DELETE FROM public.facility_menus m WHERE m.id=p_menu_id AND m.facility_id=p_facility_id;
 UPDATE public.facility_profiles p SET updated_at=greatest(clock_timestamp(),COALESCE(p.updated_at,'-infinity'::timestamptz)+interval '1 microsecond') WHERE p.id=p_facility_id;
 RETURN QUERY SELECT p_menu_id,p_facility_id,'deleted'::text;
END $$;

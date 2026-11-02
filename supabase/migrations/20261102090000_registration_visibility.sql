-- 運営の申込一覧から、申込を「隠す／戻す」ための記録（2026-11-02・本人決定「隠して戻せる方式」）。
-- 申込（salons）や店舗・公開状態・通知には一切触れない。salons を UPDATE すると
-- salons_review_revision_before_update が審査の版番号を進めてしまうため、別表に持つ。
BEGIN;
DO $guard$ BEGIN
  IF to_regclass('public.salons') IS NULL OR to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'CareLink のデータベースではありません';
  END IF;
END $guard$;
CREATE TABLE public.salon_registration_visibility (
  salon_id uuid PRIMARY KEY REFERENCES public.salons(id) ON DELETE CASCADE,
  hidden boolean NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.salon_registration_visibility ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_registration_visibility FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.salon_registration_visibility TO service_role;
-- 版番号ではなく「今の状態」で競合を判定する（隠す・戻すの 2 状態だけなので、
-- 既に目的の状態なら unchanged を返し、二重操作を成功と扱わない）。
CREATE FUNCTION public.set_salon_registration_visibility(p_actor uuid,p_salon uuid,p_hidden boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old_row public.salon_registration_visibility%ROWTYPE; new_revision integer;
BEGIN
 IF p_actor IS NULL OR p_salon IS NULL OR p_hidden IS NULL THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
 IF NOT public.registration_verified_account(p_actor) THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor AND is_platform_admin IS TRUE FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
 PERFORM 1 FROM public.salons WHERE id=p_salon FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
 SELECT * INTO old_row FROM public.salon_registration_visibility WHERE salon_id=p_salon FOR UPDATE;
 IF NOT FOUND THEN
   IF NOT p_hidden THEN RETURN jsonb_build_object('outcome','unchanged','hidden',false); END IF;
   INSERT INTO public.salon_registration_visibility(salon_id,hidden,updated_by) VALUES (p_salon,true,p_actor);
   new_revision := 1;
 ELSE
   IF old_row.hidden = p_hidden THEN RETURN jsonb_build_object('outcome','unchanged','hidden',p_hidden); END IF;
   UPDATE public.salon_registration_visibility SET hidden=p_hidden, revision=revision+1, updated_by=p_actor, updated_at=now()
     WHERE salon_id=p_salon RETURNING revision INTO new_revision;
 END IF;
 INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_values)
   VALUES(p_actor,'update','salon_registration_visibility',p_salon::text,jsonb_build_object('hidden',p_hidden,'revision',new_revision));
 RETURN jsonb_build_object('outcome','updated','hidden',p_hidden,'revision',new_revision);
END $$;
REVOKE ALL ON FUNCTION public.set_salon_registration_visibility(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_salon_registration_visibility(uuid,uuid,boolean) TO service_role;
COMMIT;

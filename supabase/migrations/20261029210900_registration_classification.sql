BEGIN;
CREATE TABLE public.salon_registration_classifications (
  salon_id uuid PRIMARY KEY REFERENCES public.salons(id) ON DELETE CASCADE,
  classification text NOT NULL CHECK (classification IN ('test','real','unknown')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.salon_registration_classifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_registration_classifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.salon_registration_classifications TO service_role;
CREATE FUNCTION public.set_salon_registration_classification(p_actor uuid,p_salon uuid,p_value text,p_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old_row public.salon_registration_classifications%ROWTYPE; new_revision integer;
BEGIN
 IF p_actor IS NULL OR p_salon IS NULL OR p_value IS NULL OR p_value NOT IN ('test','real','unknown') OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
 IF NOT public.registration_verified_account(p_actor) THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor AND is_platform_admin IS TRUE FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
 PERFORM 1 FROM public.salons WHERE id=p_salon FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
 SELECT * INTO old_row FROM public.salon_registration_classifications WHERE salon_id=p_salon FOR UPDATE;
 IF NOT FOUND THEN
   IF p_expected_revision <> 0 THEN RETURN jsonb_build_object('outcome','conflict'); END IF;
   INSERT INTO public.salon_registration_classifications(salon_id,classification,updated_by) VALUES (p_salon,p_value,p_actor);
   new_revision := 1;
 ELSE
   IF old_row.revision <> p_expected_revision THEN RETURN jsonb_build_object('outcome','conflict'); END IF;
   UPDATE public.salon_registration_classifications SET classification=p_value, revision=revision+1, updated_by=p_actor,updated_at=now() WHERE salon_id=p_salon RETURNING revision INTO new_revision;
 END IF;
 INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_values) VALUES(p_actor,'update','salon_registration_classifications',p_salon,jsonb_build_object('classification',p_value,'revision',new_revision));
 RETURN jsonb_build_object('outcome','updated','classification',p_value,'revision',new_revision);
END $$;
REVOKE ALL ON FUNCTION public.set_salon_registration_classification(uuid,uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_salon_registration_classification(uuid,uuid,text,integer) TO service_role;
COMMIT;

-- 店舗確認書類の扱いを、2026-11-03 の本人決定に合わせる。
--   ① すでにやりとりを進めていた店舗（SOY-KUFU の 3 店・耳鼻科など）は、書類なしで公開でき、書類は後から提出する。
--      対象は運営が申込ごとに「書類は後から」を付けて決める（listing_verification_deferrals）。
--   ② それ以外（これから申込む店舗）は全店、書類が必要。運営が書類を確認して承認したら公開する。
--      承認の時点で店舗名・所在地・曜日ごとの営業時間が揃っていればその場で公開し、
--      揃っていなければ店舗が設定を終えた時点で公開する（auto_publish_pending）。
-- 既存の確認記録・公開中の店舗・提出済みの書類には触れない。
BEGIN;
DO $guard$ BEGIN
  IF to_regclass('public.salons') IS NULL OR to_regclass('public.facility_profiles') IS NULL
    OR to_regclass('public.listing_verification_approvals') IS NULL THEN
    RAISE EXCEPTION 'CareLink のデータベースではありません';
  END IF;
END $guard$;

-- ① 書類は後から（申込ごと・運営だけが付け外しできる）
CREATE TABLE public.listing_verification_deferrals (
  salon_id uuid PRIMARY KEY REFERENCES public.salons(id) ON DELETE CASCADE,
  deferred boolean NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.listing_verification_deferrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_verification_deferrals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.listing_verification_deferrals TO service_role;

CREATE FUNCTION public.set_listing_verification_deferral(p_actor uuid, p_salon uuid, p_deferred boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old_row public.listing_verification_deferrals%ROWTYPE; new_revision integer;
BEGIN
 IF p_actor IS NULL OR p_salon IS NULL OR p_deferred IS NULL THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
 IF NOT public.registration_verified_account(p_actor) THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor AND is_platform_admin IS TRUE FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
 PERFORM 1 FROM public.salons WHERE id=p_salon FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
 SELECT * INTO old_row FROM public.listing_verification_deferrals WHERE salon_id=p_salon FOR UPDATE;
 IF NOT FOUND THEN
   IF NOT p_deferred THEN RETURN jsonb_build_object('outcome','unchanged','deferred',false); END IF;
   INSERT INTO public.listing_verification_deferrals(salon_id,deferred,updated_by) VALUES (p_salon,true,p_actor);
   new_revision := 1;
 ELSE
   IF old_row.deferred = p_deferred THEN RETURN jsonb_build_object('outcome','unchanged','deferred',p_deferred); END IF;
   UPDATE public.listing_verification_deferrals SET deferred=p_deferred, revision=revision+1, updated_by=p_actor, updated_at=now()
     WHERE salon_id=p_salon RETURNING revision INTO new_revision;
 END IF;
 INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_values)
   VALUES(p_actor,'update','listing_verification_deferrals',p_salon::text,jsonb_build_object('deferred',p_deferred,'revision',new_revision));
 RETURN jsonb_build_object('outcome','updated','deferred',p_deferred,'revision',new_revision);
END $$;
REVOKE ALL ON FUNCTION public.set_listing_verification_deferral(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_listing_verification_deferral(uuid,uuid,boolean) TO service_role;

-- 公開の DB ゲート：書類は後からの申込から作られた店舗は、書類の確認記録が無くても公開できる。
-- それ以外の判定は元のまま（20261030014643_listing_verification_review.sql）。
CREATE OR REPLACE FUNCTION public.guard_listing_publication_verification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE identity jsonb; checked boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'published' THEN RETURN NEW; END IF;
  identity := jsonb_build_object('name',NEW.name,'prefecture',NEW.prefecture,'city',NEW.city,'address',NEW.address);
  IF TG_OP='INSERT' THEN checked := true;
  ELSE
    checked := OLD.status IS DISTINCT FROM 'published'
      OR (EXISTS (SELECT 1 FROM public.listing_verification_approvals WHERE facility_id=NEW.id)
        AND identity IS DISTINCT FROM jsonb_build_object('name',OLD.name,'prefecture',OLD.prefecture,'city',OLD.city,'address',OLD.address));
  END IF;
  IF checked AND EXISTS (SELECT 1 FROM public.salons s
      JOIN public.listing_verification_deferrals d ON d.salon_id=s.id AND d.deferred
      WHERE s.claimed_facility_id=NEW.id) THEN
    RETURN NEW;
  END IF;
  IF checked AND NOT EXISTS (SELECT 1 FROM public.listing_verification_approvals a
      WHERE a.facility_id=NEW.id AND a.facility_identity=identity
      AND NOT EXISTS (SELECT 1 FROM unnest(a.document_ids) d(id)
        LEFT JOIN public.listing_verification_documents doc ON doc.id=d.id AND doc.facility_id=NEW.id
        LEFT JOIN public.facility_members m ON m.facility_id=NEW.id AND m.user_id=doc.submitted_by AND m.role IN ('owner','admin')
        WHERE doc.id IS NULL OR m.user_id IS NULL OR NOT EXISTS
          (SELECT 1 FROM storage.objects o WHERE o.bucket_id='listing-verification' AND o.name=doc.object_path))) THEN
    RAISE check_violation USING MESSAGE='"published_listing_verification_required"';
  END IF;
  RETURN NEW;
END;
$$;

-- ② 書類の承認で公開：揃っていればその場で、揃っていなければ設定が済んだ時点で。
ALTER TABLE public.listing_verification_approvals ADD COLUMN auto_publish_pending boolean NOT NULL DEFAULT false;

-- 公開の条件（set_facilities_publication_atomic と同じ：オーナーがいる・店舗名と所在地がある・曜日ごとの営業時間が確認済み）。
CREATE FUNCTION public.facility_ready_for_auto_publication(p_facility_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM public.facility_profiles f
    WHERE f.id=p_facility_id
      AND f.name ~ '[^[:space:]　]' AND f.prefecture ~ '[^[:space:]　]' AND f.city ~ '[^[:space:]　]' AND f.address ~ '[^[:space:]　]'
      AND public.confirmed_booking_hours(f.business_hours)
      AND EXISTS (SELECT 1 FROM public.facility_members m WHERE m.facility_id=f.id AND m.role='owner'));
$$;
REVOKE ALL ON FUNCTION public.facility_ready_for_auto_publication(uuid) FROM PUBLIC, anon, authenticated;

-- 下書きの店舗を公開する。公開の DB ゲートで止められたら、何もせず false（呼び出し元の処理は止めない）。
CREATE FUNCTION public.try_auto_publish_verified_facility(p_facility_id uuid, p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.facility_ready_for_auto_publication(p_facility_id) THEN RETURN false; END IF;
  BEGIN
    UPDATE public.facility_profiles SET status='published', updated_at=clock_timestamp()
      WHERE id=p_facility_id AND status='draft';
    IF NOT FOUND THEN RETURN false; END IF;
  EXCEPTION WHEN check_violation THEN
    RETURN false;
  END;
  UPDATE public.listing_verification_approvals SET auto_publish_pending=false WHERE facility_id=p_facility_id;
  INSERT INTO public.audit_logs(user_id,facility_id,action,table_name,record_id,new_values)
    VALUES(p_actor,p_facility_id,'publish','facility_profiles',p_facility_id::text,jsonb_build_object('status','published','reason','listing_verification_approved'));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.try_auto_publish_verified_facility(uuid,uuid) FROM PUBLIC, anon, authenticated;

-- 書類の承認（元の判定はそのまま）。承認の後、下書きの店舗なら公開を試み、条件が揃っていなければ公開待ちの印を付ける。
-- 休止（suspended）の店舗は運営が止めたものなので、自動では公開しない。
CREATE OR REPLACE FUNCTION public.approve_listing_verification(
  p_actor_id uuid, p_facility_id uuid, p_document_ids uuid[], p_expected_identity jsonb,
  p_document_verified boolean, p_authority_verified boolean
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.facility_profiles%ROWTYPE; d public.listing_verification_documents%ROWTYPE; document_id uuid;
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_document_ids IS NULL OR p_expected_identity IS NULL
    OR cardinality(p_document_ids) NOT BETWEEN 1 AND 5
    OR array_position(p_document_ids,NULL) IS NOT NULL
    OR (SELECT count(DISTINCT x) FROM unnest(p_document_ids) x) <> cardinality(p_document_ids)
    OR p_document_verified IS DISTINCT FROM true OR p_authority_verified IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'LISTING_VERIFICATION_CONFIRMATION_REQUIRED'; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND is_platform_admin IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LISTING_VERIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
  FOR document_id IN SELECT x FROM unnest(p_document_ids) x ORDER BY x LOOP
    SELECT * INTO d FROM public.listing_verification_documents
      WHERE id=document_id AND facility_id=p_facility_id FOR SHARE;
    IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM storage.objects
        WHERE bucket_id='listing-verification' AND name=d.object_path) THEN
      RAISE EXCEPTION 'LISTING_VERIFICATION_DOCUMENT_NOT_FOUND';
    END IF;
    PERFORM 1 FROM public.facility_members WHERE facility_id=p_facility_id AND user_id=d.submitted_by
      AND role IN ('owner','admin') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'LISTING_VERIFICATION_APPLICANT_CHANGED'; END IF;
  END LOOP;
  SELECT * INTO f FROM public.facility_profiles WHERE id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LISTING_VERIFICATION_FACILITY_NOT_FOUND'; END IF;
  IF p_expected_identity IS DISTINCT FROM jsonb_build_object('name',f.name,'prefecture',f.prefecture,'city',f.city,'address',f.address)
  THEN RAISE EXCEPTION 'LISTING_VERIFICATION_IDENTITY_CHANGED'; END IF;
  INSERT INTO public.listing_verification_approvals (facility_id,document_ids,reviewed_by,facility_identity)
    VALUES (f.id,p_document_ids,p_actor_id,jsonb_build_object('name',f.name,'prefecture',f.prefecture,'city',f.city,'address',f.address))
  ON CONFLICT (facility_id) DO UPDATE SET
    document_ids=EXCLUDED.document_ids, reviewed_by=EXCLUDED.reviewed_by, reviewed_at=clock_timestamp(), facility_identity=EXCLUDED.facility_identity;
  INSERT INTO public.listing_verification_approval_documents(facility_id,document_id)
    SELECT f.id, x FROM unnest(p_document_ids) x ON CONFLICT DO NOTHING;
  INSERT INTO public.audit_logs(user_id,facility_id,action,table_name,record_id,new_values)
    VALUES(p_actor_id,f.id,'verify','listing_verification_approvals',f.id::text,
      jsonb_build_object('document_ids',p_document_ids,'document_verified',true,'authority_verified',true));
  IF f.status = 'draft' AND NOT public.try_auto_publish_verified_facility(f.id, p_actor_id) THEN
    UPDATE public.listing_verification_approvals SET auto_publish_pending=true WHERE facility_id=f.id;
  END IF;
  RETURN true;
END;
$$;

-- 公開待ちの店舗が設定（所在地・営業時間など）を保存したら、条件が揃った時点で公開する。
CREATE FUNCTION public.auto_publish_after_facility_setup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status = 'draft' AND EXISTS (SELECT 1 FROM public.listing_verification_approvals
      WHERE facility_id=NEW.id AND auto_publish_pending) THEN
    PERFORM public.try_auto_publish_verified_facility(NEW.id, NULL);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.auto_publish_after_facility_setup() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER auto_publish_after_facility_setup
  AFTER UPDATE OF name, prefecture, city, address, business_hours ON public.facility_profiles
  FOR EACH ROW WHEN (NEW.status = 'draft')
  EXECUTE FUNCTION public.auto_publish_after_facility_setup();
COMMIT;

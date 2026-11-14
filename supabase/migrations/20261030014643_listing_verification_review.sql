-- A private, operator-reviewed listing approval is separate from the public
-- verification badge. Existing published listings stay visible.
BEGIN;

CREATE TABLE public.listing_verification_approvals (
  facility_id uuid PRIMARY KEY REFERENCES public.facility_profiles(id),
  document_ids uuid[] NOT NULL CHECK (cardinality(document_ids) BETWEEN 1 AND 5),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  facility_identity jsonb NOT NULL
);
ALTER TABLE public.listing_verification_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_verification_approvals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.listing_verification_approvals TO service_role;
CREATE TABLE public.listing_verification_approval_documents (
  facility_id uuid NOT NULL REFERENCES public.listing_verification_approvals(facility_id),
  document_id uuid NOT NULL REFERENCES public.listing_verification_documents(id),
  PRIMARY KEY (facility_id,document_id)
);
ALTER TABLE public.listing_verification_approval_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_verification_approval_documents FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.listing_verification_approval_documents TO service_role;

-- The privileged entry point checks the latest platform role under lock and
-- requires separate affirmative decisions for the document and the applicant's
-- authority. It never accepts a URL or an applicant-supplied approval state.
CREATE FUNCTION public.approve_listing_verification(
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
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.approve_listing_verification(uuid,uuid,uuid[],jsonb,boolean,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_listing_verification(uuid,uuid,uuid[],jsonb,boolean,boolean) TO service_role;

-- A DB-level gate covers both individual and bulk publishing. It is evaluated
-- only on new publication or a reviewed listing's identity change; unrelated
-- changes to legacy published rows do not require an immediate review.
CREATE FUNCTION public.guard_listing_publication_verification() RETURNS trigger
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
REVOKE ALL ON FUNCTION public.guard_listing_publication_verification() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_listing_publication_verification() TO service_role;
CREATE TRIGGER guard_listing_publication_verification
  BEFORE INSERT OR UPDATE OF status,name,prefecture,city,address ON public.facility_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_listing_publication_verification();

COMMIT;

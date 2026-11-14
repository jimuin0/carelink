-- Proof documents are private and must never use the public listing-photo bucket.
-- This migration only prepares storage; it does not approve or publish a listing.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('listing-verification', 'listing-verification', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id='listing-verification' AND public=false
      AND file_size_limit=10485760
      AND allowed_mime_types=ARRAY['application/pdf','image/jpeg','image/png']::text[]
  ) THEN RAISE EXCEPTION 'LISTING_VERIFICATION_BUCKET_CONFIGURATION_MISMATCH'; END IF;
END $$;

CREATE TABLE public.listing_verification_documents (
  id uuid PRIMARY KEY,
  facility_id uuid NOT NULL REFERENCES public.facility_profiles(id),
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  document_type text NOT NULL CHECK (document_type IN (
    'opening_certificate','lease','utility_bill','government_document',
    'business_insurance','commercial_facility','other'
  )),
  object_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (object_path = 'facilities/' || facility_id::text || '/' || id::text ||
    CASE mime_type WHEN 'application/pdf' THEN '.pdf' WHEN 'image/jpeg' THEN '.jpg' ELSE '.png' END)
);

ALTER TABLE public.listing_verification_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_verification_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.listing_verification_documents TO service_role;
CREATE INDEX listing_verification_documents_facility_id_idx
  ON public.listing_verification_documents(facility_id, created_at);

-- One document selection creates one immutable manifest. Replaying a lost
-- response with the same selection ID cannot create a second document.
CREATE FUNCTION public.prepare_listing_verification_document(
  p_actor_id uuid, p_facility_id uuid, p_document_id uuid,
  p_document_type text, p_mime_type text, p_byte_size integer, p_sha256 text
) RETURNS TABLE(outcome text, object_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing public.listing_verification_documents%ROWTYPE; object_name text; extension text;
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_document_id IS NULL
    OR p_document_type IS NULL OR p_document_type NOT IN ('opening_certificate','lease','utility_bill','government_document','business_insurance','commercial_facility','other')
    OR p_mime_type IS NULL OR p_mime_type NOT IN ('application/pdf','image/jpeg','image/png')
    OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 10485760
    OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$'
  THEN RETURN QUERY SELECT 'invalid'::text,NULL::text; RETURN; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id
    AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'unverified'::text,NULL::text; RETURN; END IF;
  PERFORM 1 FROM public.facility_profiles WHERE id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'unverified'::text,NULL::text; RETURN; END IF;
  extension := CASE p_mime_type WHEN 'application/pdf' THEN '.pdf' WHEN 'image/jpeg' THEN '.jpg' ELSE '.png' END;
  object_name := 'facilities/' || p_facility_id::text || '/' || p_document_id::text || extension;
  SELECT * INTO existing FROM public.listing_verification_documents WHERE id=p_document_id;
  IF FOUND THEN
    IF existing.facility_id IS DISTINCT FROM p_facility_id OR existing.submitted_by IS DISTINCT FROM p_actor_id
      OR existing.document_type IS DISTINCT FROM p_document_type OR existing.mime_type IS DISTINCT FROM p_mime_type
      OR existing.byte_size IS DISTINCT FROM p_byte_size OR existing.sha256 IS DISTINCT FROM p_sha256
      OR existing.object_path IS DISTINCT FROM object_name
    THEN RETURN QUERY SELECT 'conflict'::text,NULL::text; RETURN; END IF;
    RETURN QUERY SELECT 'prepared'::text,object_name; RETURN;
  END IF;
  IF (SELECT count(*) FROM public.listing_verification_documents WHERE facility_id=p_facility_id) >= 20
  THEN RETURN QUERY SELECT 'limit'::text,NULL::text; RETURN; END IF;
  INSERT INTO public.listing_verification_documents(id,facility_id,submitted_by,document_type,object_path,mime_type,byte_size,sha256)
    VALUES(p_document_id,p_facility_id,p_actor_id,p_document_type,object_name,p_mime_type,p_byte_size,p_sha256);
  RETURN QUERY SELECT 'prepared'::text,object_name;
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_listing_verification_document(uuid,uuid,uuid,text,text,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_listing_verification_document(uuid,uuid,uuid,text,text,integer,text) TO service_role;

COMMIT;

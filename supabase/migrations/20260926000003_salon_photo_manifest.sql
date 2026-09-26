-- Inactive v2 infrastructure. Activation still requires immutable signed
-- uploads, commit-time object verification and the atomic ownership handoff.
BEGIN;

CREATE TABLE public.salon_submission_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES public.salon_submission_intents(id) ON DELETE RESTRICT,
  selection_id uuid NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 6),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  object_path text GENERATED ALWAYS AS (
    'salon-intents/' || intent_id::text || '/' || id::text || '.' ||
    CASE mime_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png'
      WHEN 'image/webp' THEN 'webp' WHEN 'image/gif' THEN 'gif' END
  ) STORED NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intent_id, selection_id)
);
ALTER TABLE public.salon_submission_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_submission_photos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.salon_submission_photos TO service_role;
COMMENT ON TABLE public.salon_submission_photos IS
  'Immutable upload selections, not proof of upload completion. Commit must verify selected objects. No ordinary update/delete grant.';

CREATE FUNCTION public.prepare_salon_photo(
  p_intent_id uuid, p_proof_hash text, p_selection_id uuid,
  p_slot smallint, p_mime_type text, p_byte_size bigint
) RETURNS TABLE (outcome text, photo_id uuid, object_path text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  intent public.salon_submission_intents%ROWTYPE;
  photo public.salon_submission_photos%ROWTYPE;
BEGIN
  SELECT * INTO intent FROM public.salon_submission_intents WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND OR intent.proof_hash IS DISTINCT FROM p_proof_hash
    OR intent.canonical_version <> 1 OR intent.hmac_scheme <> 'proof-hkdf-sha256-v1'
    OR intent.created_at > clock_timestamp()
    OR intent.created_at + interval '72 hours' <= clock_timestamp() THEN
    RETURN QUERY SELECT 'unverified'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF intent.salon_id IS NOT NULL THEN
    RETURN QUERY SELECT 'committed'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF intent.prepare_expires_at <= clock_timestamp() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF p_selection_id IS NULL OR p_slot IS NULL OR p_slot NOT BETWEEN 0 AND 6
    OR p_mime_type IS NULL OR p_mime_type NOT IN ('image/jpeg','image/png','image/webp','image/gif')
    OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 10485760 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO photo FROM public.salon_submission_photos
    WHERE intent_id=p_intent_id AND selection_id=p_selection_id;
  IF FOUND THEN
    IF photo.slot <> p_slot OR photo.mime_type <> p_mime_type OR photo.byte_size <> p_byte_size THEN
      RETURN QUERY SELECT 'conflict'::text, NULL::uuid, NULL::text;
    ELSE
      RETURN QUERY SELECT 'prepared'::text, photo.id, photo.object_path;
    END IF;
    RETURN;
  END IF;
  -- Includes obsolete selections; this is an orphan/abuse bound, not a
  -- relaxation of the seven selected-photo commit limit.
  IF (SELECT count(*) FROM public.salon_submission_photos WHERE intent_id=p_intent_id) >= 28 THEN
    RETURN QUERY SELECT 'limit'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  INSERT INTO public.salon_submission_photos(intent_id,selection_id,slot,mime_type,byte_size)
    VALUES (p_intent_id,p_selection_id,p_slot,p_mime_type,p_byte_size)
    RETURNING * INTO photo;
  RETURN QUERY SELECT 'prepared'::text, photo.id, photo.object_path;
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_salon_photo(uuid,text,uuid,smallint,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_salon_photo(uuid,text,uuid,smallint,text,bigint)
  TO service_role;

-- BEGIN SALON STORAGE RECONCILIATION
-- Earlier migrations only UPDATEd this bucket, which is absent in a fresh DB.
-- Preserve an existing public/private decision and any stricter byte limit.
-- Do not turn an empty MIME intersection into a provider-specific "unlimited"
-- value. An incompatible out-of-band configuration requires reconciliation.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='carelink-uploads'
    AND allowed_mime_types IS NOT NULL
    AND NOT (allowed_mime_types && ARRAY['image/jpeg','image/png','image/webp','image/gif'])) THEN
    RAISE EXCEPTION 'registration bucket MIME configuration requires reconciliation';
  END IF;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('carelink-uploads','carelink-uploads',true,10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET
  file_size_limit=LEAST(COALESCE(storage.buckets.file_size_limit,10485760),10485760),
  allowed_mime_types=CASE WHEN storage.buckets.allowed_mime_types IS NULL
    THEN ARRAY['image/jpeg','image/png','image/webp','image/gif']
    ELSE ARRAY(SELECT mime FROM unnest(storage.buckets.allowed_mime_types) mime
      WHERE mime IN ('image/jpeg','image/png','image/webp','image/gif')) END;

-- Production can retain the original policy even though migration history says
-- image-only was applied. Reconcile both known names atomically, without
-- replaying historical policies that would broaden unrelated buckets.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
    AND policyname IN ('Allow anonymous upload','Allow anonymous upload images only'))
    OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND policyname IN ('Allow anonymous upload','Allow anonymous upload images only')
      AND (roles IS DISTINCT FROM ARRAY['anon']::name[] OR cmd <> 'INSERT' OR permissive <> 'PERMISSIVE')) THEN
    RAISE EXCEPTION 'registration upload policy requires reconciliation';
  END IF;
END $$;
DROP POLICY IF EXISTS "Allow anonymous upload" ON storage.objects;
DROP POLICY IF EXISTS "Allow anonymous upload images only" ON storage.objects;
CREATE POLICY "Allow anonymous upload images only" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id='carelink-uploads'
    AND (storage.foldername(name))[1]='salons'
    AND storage.extension(name) IN ('jpg','jpeg','png','webp','gif')
  );
-- Do not RENAME a policy: Supabase requires managed-table ownership for that
-- operation. DROP/CREATE is already used by the project's storage migrations.
-- A logged-in applicant must not fail the same public legacy form. This adds
-- only the identical image prefix for real authenticated identities.
CREATE POLICY "salon_legacy_authenticated_image_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND bucket_id='carelink-uploads'
    AND (storage.foldername(name))[1]='salons'
    AND storage.extension(name) IN ('jpg','jpeg','png','webp','gif')
  );
-- END SALON STORAGE RECONCILIATION

COMMIT;

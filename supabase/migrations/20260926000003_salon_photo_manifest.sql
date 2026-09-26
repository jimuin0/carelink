-- Additive infrastructure only. Does not change existing Storage policies.
-- Signed-only activation additionally requires migration 20260926000004 and
-- verified UI/commit/claim consumers. Creating this table is not activation.
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

COMMIT;

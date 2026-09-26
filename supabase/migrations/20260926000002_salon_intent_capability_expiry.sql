-- Align the service RPC with the server-enforced three-day intent capability.
-- Additive upgrade; preserves existing intent rows, receipts and grants.
BEGIN;

CREATE OR REPLACE FUNCTION public.commit_salon_submission(
  p_intent_id uuid,
  p_proof_hash text,
  p_canonical_version smallint,
  p_hmac_scheme text,
  p_payload_hmac text,
  p_registration jsonb
) RETURNS TABLE (outcome text, receipt_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  intent public.salon_submission_intents%ROWTYPE;
  receipt uuid;
BEGIN
  SELECT * INTO intent FROM public.salon_submission_intents
    WHERE id = p_intent_id FOR UPDATE;
  IF NOT FOUND OR intent.proof_hash IS DISTINCT FROM p_proof_hash
    OR intent.canonical_version IS DISTINCT FROM p_canonical_version
    OR intent.hmac_scheme IS DISTINCT FROM p_hmac_scheme THEN
    RETURN QUERY SELECT 'unverified'::text, NULL::uuid;
    RETURN;
  END IF;
  -- The capability lifetime is independent of cookie expiration. Check after
  -- acquiring the lock and before any receipt replay or write.
  IF intent.created_at > clock_timestamp()
    OR intent.created_at + interval '72 hours' <= clock_timestamp() THEN
    RETURN QUERY SELECT 'unverified'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_payload_hmac IS NULL OR p_payload_hmac !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid registration comparison';
  END IF;
  IF intent.salon_id IS NOT NULL THEN
    IF intent.payload_hmac = p_payload_hmac THEN
      RETURN QUERY SELECT 'replay'::text, intent.salon_id;
    ELSE
      RETURN QUERY SELECT 'conflict'::text, NULL::uuid;
    END IF;
    RETURN;
  END IF;
  -- After lock acquisition, and only for uncommitted intents. A committed
  -- receipt remains available after the preparation window has elapsed.
  IF intent.prepare_expires_at <= clock_timestamp() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::uuid;
    RETURN;
  END IF;
  IF jsonb_typeof(p_registration) IS DISTINCT FROM 'object'
    OR (p_registration->>'source') IS NULL
    OR (p_registration->>'source') NOT IN ('register', 'recruit') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid registration payload';
  END IF;

  -- The service caller validates and hashes these exact business values. Never
  -- populate a whole record from JSON: status/publication/claim/id are not inputs.
  INSERT INTO public.salons (
    facility_name, business_type, representative_name, contact_name, email, phone,
    contact_phone, website, postal_code, address, prefecture, city, building_name,
    nearest_station, business_hours, regular_holiday, seat_count, staff_count,
    has_parking, features, pr_text, photo_url, photo_urls, desired_start_date, source
  ) VALUES (
    p_registration->>'facility_name', p_registration->>'business_type',
    p_registration->>'representative_name', p_registration->>'contact_name',
    p_registration->>'email', p_registration->>'phone', p_registration->>'contact_phone',
    p_registration->>'website', p_registration->>'postal_code', p_registration->>'address',
    p_registration->>'prefecture', p_registration->>'city', p_registration->>'building_name',
    p_registration->>'nearest_station', p_registration->>'business_hours', p_registration->>'regular_holiday',
    (p_registration->>'seat_count')::integer, (p_registration->>'staff_count')::integer,
    (p_registration->>'has_parking')::boolean,
    ARRAY(SELECT jsonb_array_elements_text(p_registration->'features')),
    p_registration->>'pr_text', p_registration->>'photo_url',
    ARRAY(SELECT jsonb_array_elements_text(p_registration->'photo_urls')),
    p_registration->>'desired_start_date', p_registration->>'source'
  ) RETURNING id INTO receipt;

  UPDATE public.salon_submission_intents SET salon_id = receipt,
    payload_hmac = p_payload_hmac, committed_at = clock_timestamp()
    WHERE id = intent.id;

  INSERT INTO public.webhook_retry_queue
    (webhook_type, target_id, payload, registration_id, notification_kind, template_version)
    VALUES ('salon_registration_internal', receipt::text, '{}'::jsonb, receipt, 'internal', 1);
  IF p_registration->>'source' = 'register' THEN
    INSERT INTO public.webhook_retry_queue
      (webhook_type, target_id, payload, registration_id, notification_kind, template_version)
      VALUES ('salon_registration_email', receipt::text, '{}'::jsonb, receipt, 'receipt', 1);
  END IF;
  -- Queue or state write failure aborts all writes; there is no swallowed error.
  RETURN QUERY SELECT 'committed'::text, receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_salon_submission(uuid,text,smallint,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_salon_submission(uuid,text,smallint,text,text,jsonb)
  TO service_role;

COMMIT;


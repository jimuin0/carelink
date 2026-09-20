-- CareLink CL-03: enforce the required exterior photo at the database boundary.
-- Historical salons keep source = NULL; only new register submissions are constrained.
DO $guard$
BEGIN
  IF to_regclass('public.salons') IS NULL THEN
    RAISE EXCEPTION 'CareLinkのsalonsテーブルが見つかりません。接続先を確認してください。';
  END IF;
END;
$guard$;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.salons'::regclass
      AND conname = 'salons_register_requires_exterior_photo'
  ) THEN
    ALTER TABLE public.salons
      ADD CONSTRAINT salons_register_requires_exterior_photo
      CHECK (
        source IS DISTINCT FROM 'register'
        OR (
          COALESCE(cardinality(photo_urls), 0) > 0
          AND COALESCE(photo_urls[1] LIKE '%/exterior.%', false)
        )
      ) NOT VALID;
  END IF;
END;
$migration$;

ALTER TABLE public.salons
  VALIDATE CONSTRAINT salons_register_requires_exterior_photo;

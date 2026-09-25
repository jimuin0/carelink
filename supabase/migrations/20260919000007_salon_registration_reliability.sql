-- CareLink: 施設登録の同意記録・再送冪等性（CL-03/04/06）
-- 本番適用前に既存の重複キーが無いことを確認する。DDLはSupabase SQL Editorで適用する。
DO $guard$
BEGIN
  IF to_regclass('public.salons') IS NULL THEN
    RAISE EXCEPTION 'CareLinkのsalonsテーブルが見つかりません。接続先を確認してください。';
  END IF;
END
$guard$;

ALTER TABLE public.salons
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS terms_agreed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS privacy_agreed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS license_warranted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

-- Some deployed databases are missing the earlier source migration even though
-- the code and repository schema already depend on it. Preserve historical rows
-- as NULL (unknown origin) and make the catch-up safe to reapply.
ALTER TABLE public.salons
  DROP CONSTRAINT IF EXISTS salons_source_check;
ALTER TABLE public.salons
  ADD CONSTRAINT salons_source_check
  CHECK (source IS NULL OR source IN ('register', 'recruit'));
CREATE INDEX IF NOT EXISTS idx_salons_source_created_at
  ON public.salons (source, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_salons_registration_idempotency_key
  ON public.salons (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

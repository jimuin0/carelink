-- Persist the trusted server-side entry point for merchant registration evidence.
-- Existing rows remain NULL because their originating form is not recoverable from
-- the database; NULL must remain an explicit unknown rather than a guessed value.
ALTER TABLE public.salons
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE public.salons
  DROP CONSTRAINT IF EXISTS salons_source_check;

ALTER TABLE public.salons
  ADD CONSTRAINT salons_source_check
  CHECK (source IS NULL OR source IN ('register', 'recruit'));

CREATE INDEX IF NOT EXISTS idx_salons_source_created_at
  ON public.salons(source, created_at);

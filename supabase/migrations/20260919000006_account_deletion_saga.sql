-- CareLink account deletion saga state.
-- auth.admin.deleteUser is outside the public-data transaction, so a failed auth
-- deletion must remain retryable instead of leaving an untracked half-deleted user.
CREATE TABLE IF NOT EXISTS public.account_deletion_jobs (
  user_id uuid PRIMARY KEY,
  line_user_id text,
  status text NOT NULL DEFAULT 'processing',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT account_deletion_jobs_status_check
    CHECK (status IN ('processing', 'retryable', 'awaiting_auth_delete', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_jobs_retry
  ON public.account_deletion_jobs (status, updated_at)
  WHERE status IN ('retryable', 'awaiting_auth_delete');

ALTER TABLE public.account_deletion_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_deletion_jobs_service_only ON public.account_deletion_jobs;
CREATE POLICY account_deletion_jobs_service_only ON public.account_deletion_jobs
  FOR ALL USING (false) WITH CHECK (false);

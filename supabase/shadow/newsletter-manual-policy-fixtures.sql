-- Model an old scheduled row in an isolated transaction, then apply the same
-- forward constraint. No delivery operation or provider request is created.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF current_database()<>'carelink_shadow' THEN RAISE EXCEPTION 'disposable shadow required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_manual(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'manual newsletter fixture: %',label; END IF; END $$;
SELECT pg_temp.assert_manual(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.newsletter_campaigns'::regclass
  AND conname='newsletter_manual_only' AND NOT convalidated),'forward constraint preserves historical rows');
ALTER TABLE public.newsletter_campaigns DROP CONSTRAINT newsletter_manual_only;
INSERT INTO public.newsletter_campaigns(id,campaign_type,subject,html_content,status,scheduled_at) VALUES
 ('cb120000-0000-4000-8000-000000000001','user_digest','Synthetic historical','<p>Synthetic</p>','scheduled','2030-01-01T00:00:00Z');
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE public.newsletter_campaigns ADD CONSTRAINT newsletter_manual_only CHECK(status <> 'scheduled') NOT VALID;
SELECT pg_temp.assert_manual((SELECT status='scheduled' AND scheduled_at='2030-01-01T00:00:00Z'::timestamptz
  FROM public.newsletter_campaigns WHERE id='cb120000-0000-4000-8000-000000000001'),'old state and date retained');
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.newsletter_campaigns(id,campaign_type,subject,html_content,status) VALUES
      ('cb120000-0000-4000-8000-000000000002','user_digest','Rejected schedule','<p>Synthetic</p>','scheduled');
    RAISE EXCEPTION 'new scheduled campaign accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO public.newsletter_campaigns(id,campaign_type,subject,html_content,status) VALUES
 ('cb120000-0000-4000-8000-000000000002','user_digest','Synthetic draft','<p>Synthetic</p>','draft');
DO $$ BEGIN
  BEGIN
    UPDATE public.newsletter_campaigns SET status='scheduled' WHERE id='cb120000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'draft was scheduled';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE public.newsletter_campaigns SET status='cancelled' WHERE id='cb120000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_manual((SELECT status='cancelled' FROM public.newsletter_campaigns WHERE id='cb120000-0000-4000-8000-000000000001'),'old schedule can be cancelled');
SELECT pg_temp.assert_manual((SELECT status='draft' FROM public.newsletter_campaigns WHERE id='cb120000-0000-4000-8000-000000000002'),'manual draft remains available');
SELECT pg_temp.assert_manual(NOT EXISTS(SELECT 1 FROM public.newsletter_send_operations WHERE campaign_id::text LIKE 'cb120000-%'),'no automatic send was created');
ROLLBACK;

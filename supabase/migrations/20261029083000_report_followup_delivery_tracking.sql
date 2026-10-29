-- Additive local prototype. Existing claims remain legacy; no historical
-- delivery is inferred. New claims must record pending state before delivery.
BEGIN;
ALTER TABLE public.cron_report_sends ADD COLUMN delivery_state text NOT NULL DEFAULT 'legacy'
 CHECK (delivery_state IN ('legacy','pending','delivered'));
ALTER TABLE public.facility_profiles ADD COLUMN onboarding_email_delivery_state text NOT NULL DEFAULT 'legacy'
 CHECK (onboarding_email_delivery_state IN ('legacy','pending','delivered','skipped')),
 ADD CONSTRAINT onboarding_email_delivery_state_timestamp_check CHECK (onboarding_email_delivery_state='legacy' OR onboarding_email_sent_at IS NOT NULL);
ALTER TABLE public.salons ADD COLUMN registration_followup_delivery_state text NOT NULL DEFAULT 'legacy'
 CHECK (registration_followup_delivery_state IN ('legacy','pending','delivered','skipped')),
 ADD CONSTRAINT registration_followup_delivery_state_timestamp_check CHECK (registration_followup_delivery_state='legacy' OR registration_followup_sent_at IS NOT NULL);
CREATE INDEX cron_report_sends_pending_idx ON public.cron_report_sends(job,sent_at) WHERE delivery_state='pending';
CREATE INDEX facility_onboarding_pending_idx ON public.facility_profiles(onboarding_email_sent_at) WHERE onboarding_email_delivery_state='pending';
CREATE INDEX salon_followup_pending_idx ON public.salons(registration_followup_sent_at) WHERE registration_followup_delivery_state='pending';
CREATE FUNCTION public.guard_report_delivery_claim() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.job IN ('daily-summary','weekly-report') AND NEW.delivery_state IS DISTINCT FROM 'pending' THEN
  RAISE EXCEPTION 'REPORT_DELIVERY_TRACKING_REQUIRED';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.guard_onboarding_delivery_claim() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF OLD.onboarding_email_sent_at IS NULL AND NEW.onboarding_email_sent_at IS NOT NULL AND NEW.onboarding_email_delivery_state IS DISTINCT FROM 'pending' THEN
  RAISE EXCEPTION 'ONBOARDING_DELIVERY_TRACKING_REQUIRED';
 END IF;
 IF OLD.onboarding_email_delivery_state='pending' AND NEW.onboarding_email_sent_at IS NULL AND NEW.onboarding_email_delivery_state IS DISTINCT FROM 'legacy' THEN
  RAISE EXCEPTION 'ONBOARDING_DELIVERY_RELEASE_TRACKING_REQUIRED';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.guard_registration_followup_delivery_claim() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF OLD.registration_followup_sent_at IS NULL AND NEW.registration_followup_sent_at IS NOT NULL AND NEW.registration_followup_delivery_state IS DISTINCT FROM 'pending' THEN
  RAISE EXCEPTION 'FOLLOWUP_DELIVERY_TRACKING_REQUIRED';
 END IF;
 IF OLD.registration_followup_delivery_state='pending' AND NEW.registration_followup_sent_at IS NULL AND NEW.registration_followup_delivery_state IS DISTINCT FROM 'legacy' THEN
  RAISE EXCEPTION 'FOLLOWUP_DELIVERY_RELEASE_TRACKING_REQUIRED';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_report_delivery_claim(),public.guard_onboarding_delivery_claim(),public.guard_registration_followup_delivery_claim() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_report_delivery_claim BEFORE INSERT ON public.cron_report_sends FOR EACH ROW EXECUTE FUNCTION public.guard_report_delivery_claim();
CREATE TRIGGER guard_onboarding_delivery_claim BEFORE UPDATE ON public.facility_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_onboarding_delivery_claim();
CREATE TRIGGER guard_registration_followup_delivery_claim BEFORE UPDATE ON public.salons FOR EACH ROW EXECUTE FUNCTION public.guard_registration_followup_delivery_claim();
-- Keep unresolved and legacy claims even after the historical dedup window.
CREATE OR REPLACE FUNCTION public.cleanup_old_cron_report_sends() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 DELETE FROM public.cron_report_sends WHERE sent_at < now()-INTERVAL '90 days' AND delivery_state = 'delivered';
$$;
COMMIT;

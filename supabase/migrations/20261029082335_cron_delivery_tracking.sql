-- Local prototype: retain legacy rows without asserting historical delivery.
BEGIN;
ALTER TABLE public.birthday_notifications ADD COLUMN delivery_state text NOT NULL DEFAULT 'legacy'
 CHECK (delivery_state IN ('legacy','pending','delivered'));
CREATE INDEX birthday_notifications_pending_idx ON public.birthday_notifications(notified_at)
 WHERE delivery_state='pending';
CREATE FUNCTION public.guard_birthday_notification_new_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.delivery_state IS DISTINCT FROM 'pending' THEN
   RAISE EXCEPTION 'BIRTHDAY_DELIVERY_TRACKING_REQUIRED';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_birthday_notification_new_claim() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_birthday_notification_new_claim BEFORE INSERT ON public.birthday_notifications
 FOR EACH ROW EXECUTE FUNCTION public.guard_birthday_notification_new_claim();
COMMIT;

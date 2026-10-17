-- A prepared receipt has never authorized a provider write. Retirement already
-- locks the parent profile/booking before either guard runs; prepare/start take
-- KEY SHARE on those same parents. If retirement wins, a later start cannot
-- find its receipt/owner. If start wins, preserve its started external intent.
-- At REPEATABLE READ/SERIALIZABLE the FK cascade detects newer receipt rows or
-- versions and aborts serialization rather than deleting unseen started work.
-- Do not loosen the started guard, add privileges, or delete provider events.
CREATE OR REPLACE FUNCTION public.guard_calendar_pending_profile_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.calendar_sync_operations WHERE actor_id=OLD.id AND state='started') THEN
  RAISE EXCEPTION 'CALENDAR_OPERATION_PENDING' USING ERRCODE='23503';
 END IF;
 RETURN OLD;
END; $$;

CREATE OR REPLACE FUNCTION public.guard_calendar_pending_booking_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.calendar_sync_operations WHERE booking_id=OLD.id AND state='started') THEN
  RAISE EXCEPTION 'CALENDAR_OPERATION_PENDING' USING ERRCODE='23503';
 END IF;
 RETURN OLD;
END; $$;

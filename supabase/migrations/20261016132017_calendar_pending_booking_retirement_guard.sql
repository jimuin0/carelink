-- Preserve external intent when a privileged cleanup deletes a booking.
CREATE FUNCTION public.guard_calendar_pending_booking_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.calendar_sync_operations WHERE booking_id=OLD.id AND state<>'succeeded') THEN
  RAISE EXCEPTION 'CALENDAR_OPERATION_PENDING' USING ERRCODE='23503';
 END IF;
 RETURN OLD;
END; $$;
REVOKE ALL ON FUNCTION public.guard_calendar_pending_booking_delete() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_calendar_pending_booking_delete BEFORE DELETE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.guard_calendar_pending_booking_delete();

-- Forward-only: the first producer gateway has not been deployed. Preserve its
-- VOID signature and add a receipt gateway so API retries can skip all side effects.
CREATE FUNCTION public.change_customer_booking_with_outbox_receipt_atomic(p_booking_id uuid,p_user_id uuid,
  p_booking_date date,p_start_time time,p_end_time time,p_enforce_schedule boolean DEFAULT true)
RETURNS TABLE(id uuid,replayed boolean) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old_booking public.bookings%ROWTYPE;
BEGIN
  PERFORM public.lock_booking_account(p_user_id);
  SELECT * INTO old_booking FROM public.bookings WHERE bookings.id=p_booking_id;
  IF FOUND AND old_booking.user_id=p_user_id AND old_booking.status IN ('pending','confirmed')
    AND old_booking.booking_date=p_booking_date AND old_booking.start_time=p_start_time
    AND old_booking.end_time=p_end_time THEN
    RETURN QUERY SELECT p_booking_id,true;
    RETURN;
  END IF;
  PERFORM public.change_booking_atomic(p_booking_id,p_user_id,p_booking_date,p_start_time,p_end_time,p_enforce_schedule);
  UPDATE public.bookings SET updated_at=clock_timestamp() WHERE bookings.id=p_booking_id;
  PERFORM public.publish_customer_booking_transition_email(p_booking_id,'rescheduled');
  RETURN QUERY SELECT p_booking_id,false;
END $$;
REVOKE ALL ON FUNCTION public.change_customer_booking_with_outbox_receipt_atomic(uuid,uuid,date,time,time,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_customer_booking_with_outbox_receipt_atomic(uuid,uuid,date,time,time,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.change_customer_booking_with_outbox_atomic(p_booking_id uuid,p_user_id uuid,
  p_booking_date date,p_start_time time,p_end_time time,p_enforce_schedule boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM public.change_customer_booking_with_outbox_receipt_atomic(p_booking_id,p_user_id,p_booking_date,p_start_time,p_end_time,p_enforce_schedule);
END $$;

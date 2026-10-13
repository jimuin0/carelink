-- Add producer gateways only after the durable channel consumer is deployed.
-- Existing gateways stay callable for requests from the preceding release.
CREATE FUNCTION public.change_customer_booking_with_channels_atomic(p_booking_id uuid,p_user_id uuid,
  p_booking_date date,p_start_time time,p_end_time time,p_enforce_schedule boolean DEFAULT true)
RETURNS TABLE(id uuid,replayed boolean) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE receipt record;
BEGIN
  SELECT * INTO STRICT receipt FROM public.change_customer_booking_with_outbox_receipt_atomic(
    p_booking_id,p_user_id,p_booking_date,p_start_time,p_end_time,p_enforce_schedule);
  IF NOT receipt.replayed THEN
    PERFORM public.publish_customer_booking_channels(p_booking_id,'rescheduled');
  END IF;
  RETURN QUERY SELECT receipt.id,receipt.replayed;
END $$;
REVOKE ALL ON FUNCTION public.change_customer_booking_with_channels_atomic(uuid,uuid,date,time,time,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_customer_booking_with_channels_atomic(uuid,uuid,date,time,time,boolean) TO service_role;

CREATE FUNCTION public.cancel_customer_booking_with_channels_atomic(p_actor_id uuid,p_booking_id uuid,p_expected_status text)
RETURNS TABLE(id uuid,fee_context jsonb) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; policy jsonb;
BEGIN
  PERFORM public.cancel_customer_booking_with_outbox_atomic(p_actor_id,p_booking_id,p_expected_status);
  PERFORM public.publish_customer_booking_channels(p_booking_id,'cancelled');
  SELECT * INTO STRICT b FROM public.bookings WHERE bookings.id=p_booking_id;
  SELECT jsonb_build_object('free_cancel_hours',p.free_cancel_hours,'late_cancel_rate',p.late_cancel_rate)
    INTO policy FROM public.facility_cancel_policies p WHERE p.facility_id=b.facility_id;
  -- A DB read failure rolls back the entire cancellation rather than reporting
  -- an unverified zero fee after commit. No online payment is performed.
  RETURN QUERY SELECT p_booking_id,jsonb_build_object('policy',policy,'totalPrice',b.total_price,
    'bookingDate',b.booking_date,'startTime',b.start_time,'capturedAt',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.cancel_customer_booking_with_channels_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_customer_booking_with_channels_atomic(uuid,uuid,text) TO service_role;

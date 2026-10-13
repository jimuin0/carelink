-- Forward repair: use the exact fee snapshot already committed for emails.
CREATE OR REPLACE FUNCTION public.cancel_customer_booking_with_channels_atomic(p_actor_id uuid,p_booking_id uuid,p_expected_status text)
RETURNS TABLE(id uuid,fee_context jsonb) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.bookings%ROWTYPE; snapshot jsonb; policy jsonb;
BEGIN
  PERFORM public.cancel_customer_booking_with_outbox_atomic(p_actor_id,p_booking_id,p_expected_status);
  PERFORM public.publish_customer_booking_channels(p_booking_id,'cancelled');
  SELECT * INTO STRICT b FROM public.bookings WHERE bookings.id=p_booking_id;
  SELECT q.payload->'snapshot' INTO snapshot FROM public.webhook_retry_queue q
    WHERE q.payload->>'customer_booking_transition_version'='1' AND q.payload->>'kind'='cancelled'
      AND q.payload->'snapshot'->>'bookingId'=p_booking_id::text
      AND (q.payload->'snapshot'->>'bookingRevision')::timestamptz=coalesce(b.updated_at,b.created_at)
    ORDER BY q.id LIMIT 1;
  IF snapshot IS NOT NULL THEN
    RETURN QUERY SELECT p_booking_id,jsonb_build_object('policy',snapshot->'cancelPolicy',
      'totalPrice',snapshot->'totalPrice','bookingDate',snapshot->'bookingDate',
      'startTime',snapshot->'startTime','capturedAt',snapshot->'capturedAt');
  ELSE
    -- No customer/owner email addresses means there is no emailed fee to match.
    -- A failed read still rolls back the booking and every notification intent.
    SELECT jsonb_build_object('free_cancel_hours',p.free_cancel_hours,'late_cancel_rate',p.late_cancel_rate)
      INTO policy FROM public.facility_cancel_policies p WHERE p.facility_id=b.facility_id;
    RETURN QUERY SELECT p_booking_id,jsonb_build_object('policy',policy,'totalPrice',b.total_price,
      'bookingDate',b.booking_date,'startTime',b.start_time,'capturedAt',clock_timestamp());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cancel_customer_booking_with_channels_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_customer_booking_with_channels_atomic(uuid,uuid,text) TO service_role;

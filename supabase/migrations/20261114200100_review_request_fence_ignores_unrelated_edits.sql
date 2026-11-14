-- 点検 A410（2026年11月14日）：予約完了後の無関係な編集で、口コミ依頼が無音で永久に欠落する不具合を直す。
--
-- start_scheduled_email_delivery は bookings.updated_at が予約確保時の値（snapshot.bookingRevision）と一致しないと
-- ジョブを scheduled_email_superseded で failed にしていた。店舗が備考・会計を直すだけで updated_at は動くが、
-- 同じ (kind, source_id, 'once') の operation は残るので積み直す経路が無く、その来店の口コミ依頼は二度と送られなかった。
-- 宛先の同一性（email・user_id・facility_id）・完了状態・公開状態・配信停止・退会・有効期限は従来どおり送信直前に確かめる。
-- 外すのは updated_at の一致だけ。
-- 写し元: 20261023050000_review_request_withdrawn_accounts.sql（最新定義の全文。上記 1 条件だけを削除）。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.start_scheduled_email_delivery(p_queue_id uuid,p_claimed_at timestamptz,p_recipient_current boolean)
RETURNS TABLE(outcome text,started_at timestamptz) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o public.scheduled_email_operations%ROWTYPE; q public.webhook_retry_queue%ROWTYPE; b public.bookings%ROWTYPE;
 p public.profiles%ROWTYPE; valid boolean; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO o FROM public.scheduled_email_operations WHERE scheduled_email_operations.id=p_queue_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULED_EMAIL_OPERATION_NOT_FOUND'; END IF;
 IF o.kind='review_request' THEN
  PERFORM 1 FROM public.facility_profiles WHERE facility_profiles.id=(o.snapshot->>'facilityId')::uuid FOR SHARE;
  SELECT * INTO b FROM public.bookings WHERE bookings.id=o.source_id FOR SHARE;
  valid:=b.id IS NOT NULL AND b.status='completed'
    AND b.facility_id IS NOT DISTINCT FROM (o.snapshot->>'facilityId')::uuid AND p_recipient_current IS TRUE
    AND b.email IS NOT DISTINCT FROM o.snapshot->>'email' AND b.user_id IS NOT DISTINCT FROM (o.snapshot->>'userId')::uuid
    AND EXISTS(SELECT 1 FROM public.facility_profiles f WHERE f.id=b.facility_id AND f.status='published')
    AND (b.user_id IS NULL OR EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=b.user_id AND pr.email_unsubscribed IS NOT TRUE))
    AND NOT EXISTS(SELECT 1 FROM public.booking_member_withdrawals w WHERE w.booking_id=b.id) AND NOT public.email_address_opted_out(b.email);
 ELSE
  SELECT * INTO p FROM public.profiles WHERE profiles.id=o.source_id FOR SHARE;
  valid:=p.id IS NOT NULL AND p.email_unsubscribed IS NOT DISTINCT FROM false AND p_recipient_current IS TRUE
    AND EXISTS(SELECT 1 FROM public.email_unsubscribe_tokens t WHERE t.token=o.snapshot->>'unsubscribeToken' AND t.user_id=o.source_id)
    AND public.scheduled_digest_snapshot_valid(o.source_id,o.snapshot->'facilities',(o.snapshot->>'since')::timestamptz);
 END IF;
 SELECT * INTO q FROM public.webhook_retry_queue WHERE webhook_retry_queue.id=p_queue_id FOR UPDATE;
 IF NOT FOUND OR q.status<>'processing' OR q.claimed_at IS DISTINCT FROM p_claimed_at OR q.delivery_started_at IS NOT NULL THEN
  RETURN QUERY SELECT 'not_owned'::text,NULL::timestamptz; RETURN;
 END IF;
 IF q.payload->'scheduled_email_version' IS DISTINCT FROM '1'::jsonb OR q.payload->>'scheduled_kind' IS DISTINCT FROM o.kind
  OR q.target_id IS DISTINCT FROM o.snapshot->>'email' OR q.email_envelope IS NULL OR q.email_envelope->>'to' IS DISTINCT FROM q.target_id THEN
  RAISE EXCEPTION 'SCHEDULED_EMAIL_FENCE_INVALID';
 END IF;
 IF valid IS DISTINCT FROM true OR stamp>=(o.snapshot->>'expiresAt')::timestamptz THEN
  UPDATE public.webhook_retry_queue SET status='failed',processed_at=stamp,last_error='scheduled_email_superseded' WHERE webhook_retry_queue.id=q.id;
  RETURN QUERY SELECT 'superseded'::text,NULL::timestamptz; RETURN;
 END IF;
 UPDATE public.webhook_retry_queue SET delivery_started_at=stamp WHERE webhook_retry_queue.id=q.id;
 RETURN QUERY SELECT 'ready'::text,stamp;
END $$;
REVOKE ALL ON FUNCTION public.start_scheduled_email_delivery(uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_scheduled_email_delivery(uuid,timestamptz,boolean) TO service_role;

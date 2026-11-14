-- B9-5: ニュースレターが「送信中」のまま終わらない不具合と、集計の N² を直す。
--
-- 以前の sync_newsletter_delivery_state（20261009021921）は accepted+suppressed=total のときだけ
-- campaign を 'sent' にしていた。恒久失敗（queue が failed/cancelled → 受信者 state='failed'）が
-- 1 件でもあると永遠に 'sending' のままで、管理画面は「受付・結果確認中」を出し続けた。
-- また受信者 1 件の状態が変わるたびに newsletter_operation_receipt で全受信者を数え直し、
-- さらに遅延制約トリガ guard_newsletter_send_operation も同じ全件集計をしていたため、
-- 受信者 N 件の配信で O(N²) の集計になっていた。
--
-- 変更：
--   * 完了条件を「全受信者の状態が確定」＝ accepted+suppressed+failed=total にする。
--     失敗件数は従来どおり stats.failed（と互換キー bounced）に残す。campaign.status の許可値は増やさない。
--   * 集計は受信者の state 遷移 1 件ぶんの差分（旧 state −1・新 state +1）で stats を更新する。
--     受信者行と campaign 行をこの順でロックしてから差分を当てるので、同時に終わった worker 同士でも数がずれない。
--   * guard は毎回の全件集計をやめ、stats と status の整合（完了条件）だけを毎回確かめる。
--     台帳（newsletter_send_recipients）との全件突合は INSERT と status が変わる更新（完了・再開）でだけ行う。
--     全件突合は配信 1 回につき数回に限られるので O(N)。
--
-- 既存データ：恒久失敗のせいで 'sending' に留まっている campaign を、台帳から数え直して確定させる（最後の UPDATE）。
--
-- 適用順：コード配信と独立。アプリは stats をそのまま表示するだけで、失敗件数の表示は同じ PR で足す
--   （先に適用しても旧画面は「処理完了」と内訳の「失敗 N」を出すだけで壊れない）。
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.sync_newsletter_delivery_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.newsletter_send_recipients%ROWTYPE; cid uuid; next_state text; s jsonb; total int; complete boolean;
BEGIN
 IF NEW.payload->>'newsletter_delivery_version' IS DISTINCT FROM '1' THEN RETURN NEW; END IF;
 SELECT * INTO r FROM public.newsletter_send_recipients WHERE queue_id=NEW.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_RECIPIENT_REQUIRED'; END IF;
 IF NEW.status='success' AND (NEW.provider_message_id IS NULL OR NEW.delivered_at IS NULL OR NEW.delivery_started_at IS NULL) THEN
  RAISE EXCEPTION 'NEWSLETTER_ACCEPTANCE_UNVERIFIED'; END IF;
 next_state:=CASE WHEN NEW.status='success' THEN 'accepted'
  WHEN NEW.last_error='newsletter_suppressed' AND NEW.delivery_started_at IS NULL THEN 'suppressed'
  WHEN NEW.delivery_started_at IS NOT NULL THEN 'unconfirmed' WHEN NEW.status IN ('failed','cancelled') THEN 'failed' ELSE 'queued' END;
 UPDATE public.newsletter_send_recipients SET state=next_state
 ,start_claimed_at=CASE WHEN NEW.delivery_started_at IS NULL THEN NULL ELSE start_claimed_at END,
 start_time=CASE WHEN NEW.delivery_started_at IS NULL THEN NULL ELSE start_time END,rejected_retry_authorized=false
 WHERE recipient_id=r.recipient_id;
 SELECT campaign_id INTO cid FROM public.newsletter_send_operations WHERE operation_id=r.operation_id;
 -- Serialize the delta after the campaign lock so concurrent recipient workers never lose a count.
 SELECT stats INTO s FROM public.newsletter_campaigns WHERE id=cid FOR UPDATE;
 IF r.state IS DISTINCT FROM next_state THEN
  s:=s||jsonb_build_object(r.state,coalesce((s->>r.state)::int,0)-1);
  s:=s||jsonb_build_object(next_state,coalesce((s->>next_state)::int,0)+1);
 END IF;
 total:=coalesce((s->>'total')::int,0);
 complete:=total>0 AND coalesce((s->>'accepted')::int,0)+coalesce((s->>'suppressed')::int,0)+coalesce((s->>'failed')::int,0)=total;
 UPDATE public.newsletter_campaigns SET stats=s||jsonb_build_object('delivery_mode','newsletter_outbox_v1','sent',coalesce((s->>'accepted')::int,0),
   'opened',0,'clicked',0,'bounced',coalesce((s->>'failed')::int,0)),
  status=CASE WHEN complete THEN 'sent' ELSE 'sending' END,
  sent_at=CASE WHEN complete THEN coalesce(sent_at,clock_timestamp()) ELSE NULL END,
  updated_at=clock_timestamp() WHERE id=cid;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_newsletter_delivery_state() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guard_newsletter_send_operation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb; current_campaign public.newsletter_campaigns%ROWTYPE; complete boolean; key text; has_operation boolean;
BEGIN
 has_operation:=EXISTS(SELECT 1 FROM public.newsletter_send_operations WHERE campaign_id=NEW.id);
 IF NEW.status='sending' AND NOT has_operation THEN
  RAISE EXCEPTION 'NEWSLETTER_OPERATION_REQUIRED' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NOT has_operation AND NEW.status='sent' AND OLD.status<>'sent' THEN
  RAISE EXCEPTION 'NEWSLETTER_OPERATION_REQUIRED' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND has_operation AND
  (NEW.campaign_type IS DISTINCT FROM OLD.campaign_type OR NEW.subject IS DISTINCT FROM OLD.subject
   OR NEW.html_content IS DISTINCT FROM OLD.html_content OR NEW.text_content IS DISTINCT FROM OLD.text_content
   OR NEW.target_segment IS DISTINCT FROM OLD.target_segment OR NEW.status IN ('draft','scheduled','cancelled')) THEN
  RAISE EXCEPTION 'NEWSLETTER_PUBLISHED_OPERATION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF has_operation THEN
  -- Deferred events may describe earlier states in the same transaction. Verify
  -- the final row rather than an earlier event image.
  SELECT * INTO current_campaign FROM public.newsletter_campaigns WHERE id=NEW.id;
  complete:=coalesce((current_campaign.stats->>'total')::int,0)>0
   AND coalesce((current_campaign.stats->>'accepted')::int,0)+coalesce((current_campaign.stats->>'suppressed')::int,0)
     +coalesce((current_campaign.stats->>'failed')::int,0)=(current_campaign.stats->>'total')::int;
  IF current_campaign.status IS DISTINCT FROM (CASE WHEN complete THEN 'sent' ELSE 'sending' END)
   OR current_campaign.stats->>'delivery_mode' IS DISTINCT FROM 'newsletter_outbox_v1' THEN
   RAISE EXCEPTION 'NEWSLETTER_LEDGER_STATE_MISMATCH' USING ERRCODE='23514'; END IF;
  -- Full ledger reconciliation only when the campaign is created or its status changes
  -- (publish, completion, reopening), not on every recipient update (that was O(N^2)).
  IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
   receipt:=public.newsletter_operation_receipt(NEW.id);
   FOREACH key IN ARRAY ARRAY['operation_id','total','queued','unconfirmed','accepted','suppressed','failed'] LOOP
    IF current_campaign.stats->key IS DISTINCT FROM receipt->key THEN
     RAISE EXCEPTION 'NEWSLETTER_LEDGER_STATE_MISMATCH' USING ERRCODE='23514'; END IF;
   END LOOP;
  END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.guard_newsletter_send_operation() FROM PUBLIC,anon,authenticated,service_role;

-- Campaigns stuck in 'sending' only because of permanent failures: recount from the ledger and settle.
UPDATE public.newsletter_campaigns c
   SET stats=c.stats||rc.receipt||jsonb_build_object('delivery_mode','newsletter_outbox_v1','sent',(rc.receipt->>'accepted')::int,
         'opened',0,'clicked',0,'bounced',(rc.receipt->>'failed')::int),
       status='sent',sent_at=coalesce(c.sent_at,clock_timestamp()),updated_at=clock_timestamp()
  FROM (SELECT o.campaign_id,public.newsletter_operation_receipt(o.campaign_id) AS receipt
          FROM public.newsletter_send_operations o) rc
 WHERE rc.campaign_id=c.id AND c.status='sending'
   AND (rc.receipt->>'total')::int>0
   AND (rc.receipt->>'accepted')::int+(rc.receipt->>'suppressed')::int+(rc.receipt->>'failed')::int=(rc.receipt->>'total')::int;

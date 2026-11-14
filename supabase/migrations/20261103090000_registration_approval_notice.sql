-- 掲載申込を運営が「承認」したら、申込者へお知らせメールを送り、送信できたら運営の Slack に知らせる
-- （2026-11-03 本人決定「先方には承認しましたのメールが届くように。弊社の Slack には先方にメール送信しましたの通知を」）。
--
-- 送信そのものは既存の通知の待ち行列（webhook_retry_queue）と webhook-retry cron が行う。
-- ここでは、申込の状態が approved に変わった同じトランザクションの中でメールのジョブを 1 件だけ積む
-- （状態の更新とジョブの登録を分けると、片方だけ成功して「承認したのに届かない」が起き得るため）。
-- Slack の「送信しました」は、メールが送信できた後にアプリ側が approval_sent ジョブを積んで送る。
-- 同じ申込への承認メールは 1 回だけ（承認→審査中→承認と戻しても再送しない）。
BEGIN;
DO $guard$ BEGIN
  IF to_regclass('public.salons') IS NULL OR to_regclass('public.facility_profiles') IS NULL
    OR to_regclass('public.webhook_retry_queue') IS NULL THEN
    RAISE EXCEPTION 'CareLink のデータベースではありません';
  END IF;
END $guard$;

ALTER TABLE public.webhook_retry_queue DROP CONSTRAINT webhook_registration_reference;
ALTER TABLE public.webhook_retry_queue ADD CONSTRAINT webhook_registration_reference CHECK (
  (registration_id IS NULL AND notification_kind IS NULL AND template_version IS NULL
    AND webhook_type <> ALL (ARRAY['salon_registration_email'::text, 'salon_registration_internal'::text]))
  OR (registration_id IS NOT NULL AND notification_kind IS NOT NULL AND template_version IS NOT NULL
    AND template_version = 1 AND payload = '{}'::jsonb AND target_id = registration_id::text
    AND ((webhook_type = 'salon_registration_email' AND notification_kind IN ('receipt', 'approval'))
      OR (webhook_type = 'salon_registration_internal' AND notification_kind IN ('internal', 'approval_sent'))))
);

CREATE FUNCTION public.enqueue_salon_approval_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.webhook_retry_queue
    (webhook_type, target_id, payload, registration_id, notification_kind, template_version)
  VALUES ('salon_registration_email', NEW.id::text, '{}'::jsonb, NEW.id, 'approval', 1)
  ON CONFLICT (registration_id, notification_kind, template_version) WHERE registration_id IS NOT NULL DO NOTHING;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_salon_approval_notice() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER salons_enqueue_approval_notice
  AFTER UPDATE OF status ON public.salons
  FOR EACH ROW
  WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' AND NEW.source = 'register')
  EXECUTE FUNCTION public.enqueue_salon_approval_notice();
COMMIT;

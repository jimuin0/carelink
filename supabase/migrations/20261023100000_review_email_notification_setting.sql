-- 『口コミ投稿（Push通知）』を OFF にすると、新着口コミのメールまで黙って止まっていた（2026年10月23日）。
--
-- 【症状】/api/review は facility_notification_settings.push_on_review が false のとき、
--   Push（sendPushToFacilityOwners）と、オーナー・管理者への新着口コミメール（sendNewReviewNotification）を
--   まとめて送らなかった。管理画面のトグルの表記は『口コミ投稿（Push通知）』だけで、同じ画面の
--   『新規予約（Push通知）』『キャンセル（Push通知）』は Push だけを止める（予約メールは届き続ける）。
--   オーナーは「Push だけが止まる」と読むのが自然なのに、★1 の口コミもメールで届かなくなり、気づく手がかりも無かった。
--
-- 【直し方】口コミのメールは自分の設定 email_on_review で制御する（push_on_review は Push だけ）。
--   既定は true（＝これまでどおり、口コミのたびにメールが届く）。push_on_review を OFF にしていた店舗にも
--   メールが届くようになるが、それが表記どおりの動き。メールも止めたい店舗は新しいトグルで OFF にできる。
--
-- 【適用順】列の追加だけ。旧アプリはこの列を読まず、通知設定の保存（upsert）にも含めないので、
--   アプリより先に適用しても旧アプリの動きは変わらない（新しい行は既定値 true で作られる）。
--   新アプリはこの列を読むので、アプリのデプロイより【前】に適用すること。
DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

ALTER TABLE public.facility_notification_settings
  ADD COLUMN IF NOT EXISTS email_on_review boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.facility_notification_settings.email_on_review IS
  '新着口コミのメール通知（オーナー・管理者宛て）。push_on_review は Push だけを制御する。';

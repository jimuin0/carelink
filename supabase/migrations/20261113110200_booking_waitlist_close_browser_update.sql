-- 点検 A27（2026年11月13日）：booking_waitlist のブラウザからの UPDATE 権と waitlist_user_modify ポリシーを撤回する。
--
-- waitlist_user_modify（cmd=UPDATE・USING user_id = auth.uid()・WITH CHECK なし）は、本人の行なら
-- status・date・start_time・facility_id・notified_at・expires_at まで任意に書き換えられた
-- （例：status を 'waiting' に戻して通知を再度受ける、施設や日時を差し替える）。
-- アプリでブラウザ権限から更新していたのはキャンセル（DELETE /api/waitlist）だけで、同日の変更で
-- service_role ＋ .eq('user_id', 本人) に移した。登録（POST）と通知（cron）は以前から service_role。
-- INSERT 権も外す（INSERT ポリシーは既に無い＝常に拒否。権限を実態に合わせる）。
-- 本人の閲覧（waitlist_user_read）・施設メンバーの閲覧・本人の削除（waitlist_user_delete）は変更しない。
--
-- 🔴 適用順序：【コードの配信の後】に適用する（2 段目）。旧コードのキャンセル処理はブラウザ権限で UPDATE するため、
--    先に適用するとキャンセルが「見つかりません（404）」になる。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

DROP POLICY IF EXISTS waitlist_user_modify ON public.booking_waitlist;
REVOKE INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.booking_waitlist FROM PUBLIC, anon, authenticated;

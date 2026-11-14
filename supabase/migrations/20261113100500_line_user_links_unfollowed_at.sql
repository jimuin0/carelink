-- 点検 B3-12（2026年11月13日）：LINE のフォロー解除（ブロック）で line_user_links の行を消さず、unfollowed_at を記録する。
--
-- 以前は unfollow で行そのものを削除していたため、本人確認済みの連携（user_id・proof_version・verified_at）まで消え、
-- 再フォローしても本人が連携し直すまで LINE 通知が届かなかった。
--   unfollow   → unfollowed_at = now()（src/app/api/line/webhook/route.ts の handleUnfollow）
--   再 follow  → unfollowed_at = NULL（同 handleFollow の upsert。連携列は更新しない）
--   送信側     → unfollowed_at のある行を宛先から外す（src/lib/line-link.ts・booking-create-notifications.ts・
--                customer-booking-channel.ts・cron/webhook-retry）
--
-- 🔴 適用順序：この migration を【コードの配信より先に】適用する（1 段目）。新しいコードは follow の upsert で
--    unfollowed_at を書くため、列が無いと follow の受付が失敗する。列の追加だけなので旧コードには影響しない。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

ALTER TABLE public.line_user_links ADD COLUMN IF NOT EXISTS unfollowed_at timestamptz;
COMMENT ON COLUMN public.line_user_links.unfollowed_at IS
  'LINE のフォロー解除（ブロック）を受けた時刻。NULL＝フォロー中。値がある行には送信しない（再フォローで NULL に戻す）';

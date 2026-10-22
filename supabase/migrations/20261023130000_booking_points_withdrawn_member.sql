-- 退会した会員の予約（ポイント利用あり）を、店舗が受付・完了・キャンセル・会計できない（2026年10月23日）。
--
-- 【症状】ポイントを使って予約した会員が、来店日を過ぎた（店舗がまだ結果を記録していない）予約を残したまま
--   退会すると、bookings.user_id は bookings_user_id_fkey の ON DELETE SET NULL で NULL になり、points_used は
--   残る。退会のガード（guard_account_deletion_active_bookings・/api/account/delete）は今日以降の予約しか
--   見ないので、退会はそのまま通る。その後、店舗が予約詳細で「受付」「完了」「無断キャンセル」「キャンセル」を
--   押すと（save_booking_email_event_atomic）、あるいは会計を保存すると（checkout_booking_with_points_atomic。
--   完了にしない保存でも status を SET に含む）、AFTER UPDATE OF status の sync_booking_points が
--   「user_id が無いのにポイントを使っている」として POINTS_AUTH_REQUIRED を投げ、トランザクションごと
--   取り消される。店舗の画面には 500「更新に失敗しました」「会計の保存に失敗しました」が毎回出て
--   （Slack にも毎回通知）、予約は二度と閉じられず、完了・無断キャンセルの集計にも売上にも入らない。
--
-- 【直し方】sync_booking_points の「user_id が NULL」の分岐だけを変える。
--   * INSERT（予約の作成）は従来どおり POINTS_AUTH_REQUIRED（ログインしていない予約はポイントを使えない）。
--   * UPDATE で user_id が NULL なのは、会員が退会した後だけ（アプリにも migration にも bookings.user_id を
--     NULL へ書き換える経路は無く、外れるのは ON DELETE SET NULL のときだけ）。退会と同じトランザクションで、
--     その会員の台帳（user_points）は cleanup_deleting_account_personal_data と user_points_user_id_fkey の
--     CASCADE で消えているので、返還・付与・取消する相手も行も無い。何もせず通す（RETURN NEW）。
--     退会者のポイントは戻さない（アカウントと一緒に消えている）。
--   * UPDATE でも、この予約を指す台帳の行がまだ残っているなら（持ち主が分からないのに台帳だけがある＝
--     想定外の状態）、従来どおり POINTS_AUTH_REQUIRED で止める（推測で返還・付与・取消をしない）。
--   * ポイントを使っていない予約（points_used が 0・NULL）は従来どおり何もせず通す。
--   ほかの分岐（会員の予約の控除・来店ポイント・取消・返還）は 1 文字も変えない。
--
-- 本体は 20261023000100_booking_visit_points_cap.sql の sync_booking_points の写し（それより後に定義し直す
-- migration も pg_get_functiondef での書き換えも無い）で、変えたのは上の分岐だけ。属性（SECURITY DEFINER・
-- search_path=''）と REVOKE は同じ内容で再記述する。トリガ booking_points_atomic は関数名で結び付いて
-- いるので作り直さない。
--
-- 適用順序: アプリのデプロイの前後どちらでもよい。関数の判定を緩めるだけで、署名・権限・戻り値は変えない。
--   デプロイ済みのアプリ（origin/fix/fourth-sweep-integration）のままでも、退会者の予約の状態変更と会計が通る。
--   新しいアプリは、それでもポイントの記録と照合できない予約（POINTS_* のエラー）を 500 ではなく 409 と
--   案内文で返す（src/lib/booking-points-error.ts）。
-- データの書き換えは無い（本番の user_points は 0 行）。
-- 実 DB での検証: supabase/shadow/booking-points-withdrawn-member-fixtures.sql。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

-- Copy of 20261023000100_booking_visit_points_cap.sql; only the branch without an account changes.
CREATE OR REPLACE FUNCTION public.sync_booking_points() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE balance bigint; earned int; awarded int; debit int;
BEGIN
  IF coalesce(NEW.points_used,0)<0 THEN RAISE EXCEPTION 'INVALID_BOOKING_POINTS'; END IF;
  IF NEW.user_id IS NULL THEN
    -- 20261023130000: spending points needs an account when the booking is made.
    -- On a later status change user_id is NULL only because the member deleted the
    -- account (ON DELETE SET NULL), and the ledger went with the account: nothing is
    -- left to refund, award or reverse. Ledger rows that still point at the booking
    -- have no resolvable owner, so they keep the refusal.
    IF coalesce(NEW.points_used,0)>0 AND (TG_OP='INSERT'
      OR EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=NEW.id))
      THEN RAISE EXCEPTION 'POINTS_AUTH_REQUIRED'; END IF;
    RETURN NEW;
  END IF;
  PERFORM public.lock_booking_account(NEW.user_id);
  IF TG_OP='INSERT' AND coalesce(NEW.points_used,0)>0 THEN
    SELECT coalesce(sum(points),0) INTO balance FROM public.user_points WHERE user_id=NEW.user_id;
    IF balance<NEW.points_used THEN RAISE EXCEPTION 'POINTS_INSUFFICIENT'; END IF;
    INSERT INTO public.user_points(user_id,points,reason,booking_id,booking_operation)
      VALUES(NEW.user_id,-NEW.points_used,'予約利用 ('||left(NEW.id::text,8)||')',NEW.id,'debit');
  END IF;
  IF NEW.status='completed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    -- Capped at the booking-time amount; nothing for the shop's own owner / admin (20261023000100).
    earned:=public.booking_visit_points_due(NEW.user_id,NEW.facility_id,NEW.total_price,NEW.points_base_price);
    IF earned>0 THEN
      -- Unclassified legacy booking rows require reconciliation, not guesswork.
      IF EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=NEW.id AND booking_operation IS NULL)
        THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
      INSERT INTO public.user_points(user_id,points,reason,booking_id,booking_operation)
        VALUES(NEW.user_id,earned,'来店ポイント',NEW.id,'award');
    END IF;
  ELSIF TG_OP='UPDATE' AND OLD.status='completed' AND NEW.status IS DISTINCT FROM 'completed' THEN
    SELECT points INTO awarded FROM public.user_points
      WHERE booking_id=NEW.id AND user_id=NEW.user_id AND booking_operation='award';
    IF EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=NEW.id AND booking_operation IS NULL)
      THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
    IF coalesce(awarded,0)>0 THEN
      INSERT INTO public.user_points(user_id,points,reason,booking_id,booking_operation)
        VALUES(NEW.user_id,-awarded,'来店ポイント取消',NEW.id,'reversal');
    END IF;
  END IF;
  IF NEW.status='cancelled' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'cancelled')
    AND coalesce(NEW.points_used,0)>0 THEN
    SELECT -points INTO debit FROM public.user_points
      WHERE booking_id=NEW.id AND user_id=NEW.user_id AND booking_operation='debit';
    IF debit IS DISTINCT FROM NEW.points_used
      THEN RAISE EXCEPTION 'POINTS_LEGACY_RECONCILIATION_REQUIRED'; END IF;
    -- An exact historical refund is already fulfilled; never credit it twice.
    IF NOT EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=NEW.id AND booking_operation='refund') THEN
      INSERT INTO public.user_points(user_id,points,reason,booking_id,booking_operation)
        VALUES(NEW.user_id,NEW.points_used,'キャンセル返還',NEW.id,'refund');
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_booking_points() FROM PUBLIC,anon,authenticated,service_role;

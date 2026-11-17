-- profiles の欠けたオーナーにも、ログイン用メールアドレス宛てに新規予約のメールを送る（点検 B4-13 の残り・2026年11月15日）。
--
-- 【それまでの状態】20261114500000 で、profiles の無いオーナーがいても予約受付は止まらなくなったが、
-- そのオーナーには新規予約のメールもプッシュも出していなかった（アプリが console.error に残すだけ）。
-- そのオーナーは管理画面も開けない（既存の安全設計。変えない）ので、予約が入ったことに気づく手段が無かった。
--
-- 【本人の決定】「プロフィールが欠けたオーナーにも、ログイン用のメールアドレス（auth.users.email）宛てに
-- 新規予約のメールを送る」。予約は従来どおり止めない。
--
-- 【この migration で変えること】
--   1. オーナー向け新規予約メールの宛先を 1 か所で決める関数 booking_owner_notification_emails を追加する。
--      規則＝profiles のメールがあればそれ（従来どおり）、無ければ（profiles 自体が無い場合も）
--      メール確認済み（email_confirmed_at あり）のログイン用メール、どちらも無ければ NULL（送らない）。
--      auth.users を読むのはこの SECURITY DEFINER 関数の中だけ。実行権は service_role だけ
--      （anon / authenticated には与えない＝ブラウザから他人のログイン用メールを引く経路は作らない）。
--      アプリ（src/lib/booking-create-notifications.ts）も同じ関数で宛先を決めるので、計画と照合が食い違わない。
--   2. 予約受付 RPC 2 本（create_booking_with_receipt_atomic / _dated_atomic）のメール宛先の期待値と
--      各メール通知の照合を、この関数に揃える。プッシュの照合（profiles が在るオーナーだけ）は変えない。
--   3. 送信直前の照合（start_booking_create_notification）のオーナー宛てメールの確認も同じ関数に揃える
--      （揃えないと、受付時に積んだログイン用メール宛てのジョブが送信時に superseded で落ちる）。
--   受信者集合の照合（actual_owners＝全オーナー）・スナップショット照合・その他の文言は一字一句そのまま。
--
-- 【書き方について】対象 3 関数は過去の migration が pg_get_functiondef を置換して作った合成定義で、
-- 全文はどの migration にも 1 か所に書かれていない。20261114500000 と同じく
-- 「現在の定義を読み、対象の部分がちょうど 1 回あることを確かめて置換、無ければ例外で止める」形にした。
--
-- 【本番の適用順序】この migration を適用 → コードをデプロイ。
--   新 RPC は「ログイン用メール宛ての計画」を期待するので、旧コード（profiles 欠けのオーナーには計画しない）は、
--   profiles 欠け（または profiles のメール欠け）かつ確認済みログイン用メールのあるオーナーがいる施設でだけ
--   BOOKING_NOTIFICATION_TARGET_CHANGED で受付に失敗する。適用からデプロイまでの間をできるだけ短くすること。
--   該当施設が無いことを先に確かめておけば、その間も挙動は変わらない（確認用 SQL は報告に記載）。
--   コードを先に出すと、該当施設では旧 RPC が新しい計画を弾く（同じ失敗）。どちらの順でも該当施設以外は無影響。
--   既存データ・既存の予約・キューは書き換えない。お客様向けのメール・画面にログイン用メールは載らない（宛先にだけ使う）。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE FUNCTION public.booking_owner_notification_emails(p_facility_id uuid)
RETURNS TABLE(user_id uuid, email text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT DISTINCT m.user_id,
    coalesce(nullif(p.email,''), CASE WHEN u.email_confirmed_at IS NOT NULL THEN nullif(u.email,'') END)
  FROM public.facility_members m
  LEFT JOIN public.profiles p ON p.id=m.user_id
  LEFT JOIN auth.users u ON u.id=m.user_id
  WHERE m.facility_id=p_facility_id AND m.role IN ('owner','admin')
$$;
REVOKE ALL ON FUNCTION public.booking_owner_notification_emails(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.booking_owner_notification_emails(uuid) TO service_role;

DO $owner_email$
DECLARE
  sig text;
  definition text;
  old_expected constant text := $old$    ARRAY(SELECT DISTINCT p.email FROM public.profiles p JOIN public.facility_members m ON m.user_id=p.id WHERE m.facility_id=p_facility_id AND m.role IN ('owner','admin') AND nullif(p.email,'') IS NOT NULL ORDER BY p.email),$old$;
  new_expected constant text := $new$    ARRAY(SELECT DISTINCT e.email FROM public.booking_owner_notification_emails(p_facility_id) e WHERE e.email IS NOT NULL ORDER BY e.email),$new$;
  old_item constant text := $old$      PERFORM m.user_id FROM public.facility_members m JOIN public.profiles p ON p.id=m.user_id
        WHERE m.facility_id=p_facility_id AND m.user_id=(item->>'user_id')::uuid AND m.role IN ('owner','admin')
          AND (kind<>'email' OR p.email=target) FOR SHARE OF m,p;$old$;
  new_item constant text := $new$      PERFORM m.user_id FROM public.facility_members m
        WHERE m.facility_id=p_facility_id AND m.user_id=(item->>'user_id')::uuid AND m.role IN ('owner','admin')
          AND CASE WHEN kind='email' THEN EXISTS(SELECT 1 FROM public.booking_owner_notification_emails(p_facility_id) e WHERE e.user_id=m.user_id AND e.email=target)
            ELSE EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=m.user_id) END FOR SHARE OF m;$new$;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.create_booking_with_receipt_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[],jsonb)',
    'public.create_booking_with_receipt_dated_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[],jsonb,date,date[],date,date)'
  ] LOOP
    definition := pg_catalog.pg_get_functiondef(sig::regprocedure);
    IF strpos(definition, old_expected) = 0
      OR (length(definition) - length(replace(definition, old_expected, ''))) / length(old_expected) <> 1 THEN
      RAISE EXCEPTION 'BOOKING_OWNER_EMAIL_EXPECTED_FORWARD_UPDATE_MISMATCH: %', sig;
    END IF;
    IF strpos(definition, old_item) = 0
      OR (length(definition) - length(replace(definition, old_item, ''))) / length(old_item) <> 1 THEN
      RAISE EXCEPTION 'BOOKING_OWNER_EMAIL_ITEM_FORWARD_UPDATE_MISMATCH: %', sig;
    END IF;
    EXECUTE replace(replace(definition, old_expected, new_expected), old_item, new_item);
  END LOOP;
END $owner_email$;

DO $owner_email_fence$
DECLARE
  definition text;
  old_fence constant text := $old$    PERFORM m.user_id FROM public.facility_members m JOIN public.profiles p ON p.id=m.user_id
      WHERE m.user_id=recipient AND m.facility_id=o.facility_id AND m.role IN ('owner','admin')
        AND (q.webhook_type<>'email' OR p.email=q.target_id) FOR SHARE OF m,p;$old$;
  new_fence constant text := $new$    PERFORM p.id FROM public.profiles p WHERE p.id=recipient FOR SHARE;
    PERFORM m.user_id FROM public.facility_members m
      WHERE m.user_id=recipient AND m.facility_id=o.facility_id AND m.role IN ('owner','admin')
        AND CASE WHEN q.webhook_type='email' THEN EXISTS(SELECT 1 FROM public.booking_owner_notification_emails(o.facility_id) e WHERE e.user_id=m.user_id AND e.email=q.target_id)
          ELSE EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=m.user_id) END FOR SHARE OF m;$new$;
BEGIN
  definition := pg_catalog.pg_get_functiondef('public.start_booking_create_notification(uuid,timestamptz)'::regprocedure);
  IF strpos(definition, old_fence) = 0
    OR (length(definition) - length(replace(definition, old_fence, ''))) / length(old_fence) <> 1 THEN
    RAISE EXCEPTION 'BOOKING_OWNER_EMAIL_FENCE_FORWARD_UPDATE_MISMATCH';
  END IF;
  EXECUTE replace(definition, old_fence, new_fence);
END $owner_email_fence$;

REVOKE ALL ON FUNCTION public.create_booking_with_receipt_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_with_receipt_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[],jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.create_booking_with_receipt_dated_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[],jsonb,date,date[],date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_with_receipt_dated_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[],jsonb,date,date[],date,date) TO service_role;
REVOKE ALL ON FUNCTION public.start_booking_create_notification(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_booking_create_notification(uuid,timestamptz) TO service_role;

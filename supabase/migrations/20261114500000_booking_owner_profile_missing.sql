-- オーナーの profiles が 1 件欠けても予約受付を止めない（点検 B4-13・2026年11月14日）。
--
-- 【それまでの状態】予約受付 RPC（create_booking_with_receipt_atomic / _dated_atomic）は、
-- オーナー向けプッシュの期待値を「全オーナー（facility_members の owner/admin）」としていた。
-- 一方、各通知の照合は profiles と JOIN するため、profiles の無いオーナーが 1 人でもいると
-- アプリ側の計画とどう組んでも一致せず、その施設の予約が全部 BOOKING_NOTIFICATION_TARGET_CHANGED で
-- 失敗していた（アプリ側も profiles の件数不一致で受付前に止めていた）。
--
-- 【この migration で変えること】オーナー向けプッシュの期待値を
-- 「profiles が在るオーナー」に限る 1 行だけ。メールの期待値は元から profiles と JOIN しており変えない。
-- 受信者集合の照合（actual_owners＝全オーナー）・各通知の照合・その他の文言は一字一句そのまま。
--
-- 【書き方について】この 2 関数は 20261022100000 / 20261028045729 が pg_get_functiondef を
-- 置換して作った合成定義で、全文はどの migration にも 1 か所に書かれていない。
-- 既存の 2 本と同じ「現在の定義を読み、対象の 1 行がちょうど 1 回あることを確かめて置換、
-- 無ければ例外で止める」形にした（定義の写し間違いで他の照合を弱めないため）。
--
-- 【本番の適用順序】この migration を適用 → コードをデプロイ。
--   旧コードは profiles 欠けのとき受付前に止まるので、先に適用しても挙動は変わらない。
--   コードを先に出すと、profiles 欠けの施設では旧 RPC が照合で弾く（今と同じ失敗のまま）。
--   既存データ・既存の予約・キューは書き換えない。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

DO $owner_push$
DECLARE
  sig text;
  definition text;
  old_line constant text := 'expected_push:=CASE WHEN actual_owner_push THEN owner_ids ELSE ARRAY[]::uuid[] END;';
  new_line constant text := 'expected_push:=CASE WHEN actual_owner_push THEN ARRAY(SELECT p.id FROM public.profiles p WHERE p.id=ANY(owner_ids) ORDER BY p.id) ELSE ARRAY[]::uuid[] END;';
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.create_booking_with_receipt_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[],jsonb)',
    'public.create_booking_with_receipt_dated_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[],jsonb,date,date[],date,date)'
  ] LOOP
    definition := pg_catalog.pg_get_functiondef(sig::regprocedure);
    IF strpos(definition, old_line) = 0
      OR (length(definition) - length(replace(definition, old_line, ''))) / length(old_line) <> 1 THEN
      RAISE EXCEPTION 'BOOKING_OWNER_PUSH_FORWARD_UPDATE_MISMATCH: %', sig;
    END IF;
    EXECUTE replace(definition, old_line, new_line);
  END LOOP;
END $owner_push$;

REVOKE ALL ON FUNCTION public.create_booking_with_receipt_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_with_receipt_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[],jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.create_booking_with_receipt_dated_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[],jsonb,date,date[],date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_with_receipt_dated_atomic(uuid,uuid,text,text,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,integer,integer,text,uuid[],jsonb,date,date[],date,date) TO service_role;

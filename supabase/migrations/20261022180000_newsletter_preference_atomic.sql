-- マイページの「お知らせメールを受け取る」を、配信停止の抑止行ごと 1 トランザクションで切り替える（2026年10月22日）。
--
-- 【それまでの欠陥】メール末尾の「配信停止」リンク（/api/unsubscribe → unsubscribe_newsletter_atomic）は
--   (a) profiles.email_unsubscribed=true と
--   (b) newsletter_subscriptions の抑止行（is_active=false。既存行が無ければ source='unsubscribe' の
--       'all' 行を user_id NULL で新規作成）
--   の 2 つを書く。一方マイページのトグル（src/app/mypage/profile/page.tsx）は ブラウザから
--   profiles.email_unsubscribed を書き換えるだけで、(b) は残ったままだった。宛先の決定は
--   アプリ側（src/lib/newsletter-send.ts）も DB 側（newsletter_current_recipients）も
--   「is_active=false の行がある宛先は除外」なので、画面には「配信を再開しました」と出るのに
--   ニュースレターは二度と届かなかった。authenticated は newsletter_subscriptions に書き込めず
--   （20261009021921 で REVOKE 済み）、user_id NULL の抑止行は本人から見えもしないので、本人が直す手段も無かった。
--
-- 【この関数】受け取る（p_receive=true）ときは、本人の【確認済みログインメール】（auth.users.email）
--   の宛先についてだけ、次をまとめて行う。
--     - profiles.email_unsubscribed=false（本人の行だけ）
--     - source='unsubscribe' の抑止専用行（配信停止リンクが作った行）を削除
--     - それ以外の停止中の行（以前の購読）を is_active=true・unsubscribed_at=NULL に戻す
--   受け取らない（p_receive=false）ときは、従来どおり profiles.email_unsubscribed=true にするだけ
--   （宛先の除外は profiles の旗だけで成立する）。
--
-- 【なぜ profiles.email ではなく auth.users.email か】profiles.email は本人が PostgREST で自由に
--   書き換えられる（列の GRANT 制限が無い）。そこを宛先にすると、自分の profiles.email を他人の
--   アドレスに書き換えてから「受け取る」を押すだけで、他人が配信停止した宛先を勝手に再購読させられる。
--   確認済みのログインメール（email_confirmed_at が入っているもの）なら、そのメールボックスの持ち主本人で
--   あることが Supabase Auth で保証されている。未確認のアカウントは旗だけを戻し、抑止行には触れない。
--   ニュースレターの宛先は profiles.email だが、アプリには profiles.email を変更する経路が無く、
--   作成時（handle_new_user）に auth.users.email と同じ値が入るので、通常は同じ宛先になる。
--
-- 【ロック順】unsubscribe_newsletter_atomic と同じ「アカウントの advisory ロック → profiles 行 →
--   newsletter_subscriptions 行（id 順）」に揃え、同時に配信停止リンクが押されてもデッドロックしない。
--
-- 【適用順】関数を足すだけで既存の権限・関数には触れない。旧アプリ（ブラウザ直書き）はそのまま動くので、
--   アプリのデプロイより【先に】適用する（新アプリはこの関数が無いとトグルが 500 になる）。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION public.set_newsletter_preference_atomic(p_user_id uuid, p_receive boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE address text; cleared integer := 0; reactivated integer := 0;
BEGIN
 IF p_user_id IS NULL OR p_receive IS NULL THEN
  RAISE EXCEPTION 'NEWSLETTER_PREFERENCE_INVALID' USING ERRCODE='23514';
 END IF;
 -- auth.users の行が無ければ BOOKING_ACCOUNT_UNAVAILABLE で止まる（削除済みアカウント）。
 PERFORM public.lock_booking_account(p_user_id);
 -- 抑止を外してよいのは、Supabase Auth が持ち主を確認済みのログインメールだけ（未確認なら旗だけ戻す）。
 SELECT lower(btrim(u.email)) INTO address FROM auth.users u WHERE u.id=p_user_id AND u.email_confirmed_at IS NOT NULL;
 PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'NEWSLETTER_PREFERENCE_PROFILE_MISSING' USING ERRCODE='P0002';
 END IF;
 IF p_receive AND address IS NOT NULL AND address<>'' THEN
  PERFORM 1 FROM public.newsletter_subscriptions WHERE lower(btrim(email))=address ORDER BY id FOR UPDATE;
 END IF;
 UPDATE public.profiles SET email_unsubscribed = NOT p_receive WHERE id=p_user_id;
 IF p_receive AND address IS NOT NULL AND address<>'' THEN
  DELETE FROM public.newsletter_subscriptions
   WHERE lower(btrim(email))=address AND NOT is_active AND source='unsubscribe';
  GET DIAGNOSTICS cleared = ROW_COUNT;
  UPDATE public.newsletter_subscriptions SET is_active=true, unsubscribed_at=NULL
   WHERE lower(btrim(email))=address AND NOT is_active;
  GET DIAGNOSTICS reactivated = ROW_COUNT;
 END IF;
 RETURN jsonb_build_object('success',true,'receive',p_receive,'cleared',cleared,'reactivated',reactivated);
END $$;
REVOKE ALL ON FUNCTION public.set_newsletter_preference_atomic(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_newsletter_preference_atomic(uuid,boolean) TO service_role;

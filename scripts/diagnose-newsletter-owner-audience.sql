-- =============================================================================
-- 運営ニュースレター（施設オーナー向け）の宛先が、20261023150100 の前後でどう変わるか（2026年10月23日）
--
-- 【使い方】Supabase Dashboard → SQL Editor に貼って実行する。
--   project ref は必ず xzafxiupbflvgbarrihe（CareLink 本番）であることを確認すること。
--   https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe/sql
--   auth.users を読むので、SQL Editor（postgres 権限）で実行すること。
--
-- 【安全性】本ファイルは SELECT のみ。1行も書き換えない。
--
-- 【何を見るか】
--   20261023150100 以降、オーナーの宛先は profiles.email ではなく確認済みのログインメール
--   （auth.users.email・email_confirmed_at あり）になり、配信停止は email_address_opted_out
--   （配信停止リンクの停止行＋確認済みログインメールの持ち主の配信停止）で判定する。
--   ① 宛先が変わるオーナー（profiles.email とログインメールが違う・メール未確認）。0 行なら宛先は変わらない。
--      1 行でもあると、migration を先に当ててアプリを後からデプロイした場合、その間の配信は
--      NEWSLETTER_AUDIENCE_CONFLICT（409）で止まる（誤った宛先へは送らない）。
--   ② 他人のアドレスを自分の profiles.email に書いて配信停止にしている行（修正前はこれで他人への配信が止まっていた）。
--
-- @check facility_members.user_id
-- @check facility_members.role
-- @check facility_members.facility_id
-- @check profiles.id
-- @check profiles.email
-- @check profiles.email_unsubscribed
-- =============================================================================


-- =============================================================================
-- 🔴 接続先ガード（先頭で必ず実行される）
--
-- Supabase の SQL Editor はプロジェクトごとにタブが開くため、【別プロジェクトのタブに
-- 貼ってしまう】事故が繰り返し起きている（2026年8月2日 soel で実行し「RLS が90本欠落」
-- という存在しない事故を報告しかけた／2026年8月12日 admin-dashboard で実行し
-- 「audit_logs が存在しない」となった）。人の注意力では防げないので、SQL 自身に検査させる。
--
-- CareLink 本番 project ref = xzafxiupbflvgbarrihe
-- 目印テーブルが揃っていなければ、以降を1行も実行せずに落とす。
-- =============================================================================
DO $connguard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL
     OR to_regclass('public.facility_menus') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION
      '接続先が CareLink 本番ではありません。project ref = xzafxiupbflvgbarrihe のタブで実行してください（現在の接続先には facility_profiles / facility_menus / audit_logs のいずれかがありません）';
  END IF;
END
$connguard$;

-- ① 宛先が変わるオーナー（メールアドレスそのものは出さず、一致・確認の有無だけを出す）
SELECT m.user_id, count(DISTINCT m.facility_id) AS owned_facilities,
  (lower(btrim(p.email)) IS NOT DISTINCT FROM lower(btrim(u.email))) AS profile_email_matches_login,
  (u.email_confirmed_at IS NOT NULL) AS login_email_confirmed,
  p.email_unsubscribed
FROM facility_members m
JOIN profiles p ON p.id = m.user_id
JOIN auth.users u ON u.id = m.user_id
WHERE m.role = 'owner'
GROUP BY m.user_id, p.email, u.email, u.email_confirmed_at, p.email_unsubscribed
HAVING lower(btrim(p.email)) IS DISTINCT FROM lower(btrim(u.email)) OR u.email_confirmed_at IS NULL
ORDER BY m.user_id;

-- ② 配信停止にした profiles のうち、profiles.email が自分のログインメールと違う行（他人のアドレスの可能性）
SELECT p.id AS account_id,
  EXISTS (SELECT 1 FROM auth.users o WHERE o.id <> p.id AND lower(btrim(o.email)) = lower(btrim(p.email))) AS names_another_accounts_login_email
FROM profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.email_unsubscribed IS TRUE
  AND lower(btrim(p.email)) IS DISTINCT FROM lower(btrim(u.email))
ORDER BY names_another_accounts_login_email DESC, p.id;

-- ポイント残高をサーバ側 SUM で返す RPC（round6・残高過少表示の根本対策）
--
-- 背景: user_points は加減算イベントの台帳で、残高 = 全行の SUM。LIFF は「直近50件のログ表示」用クエリの
--   結果をそのまま残高合算に流用しており、取引が50件を超えるリピート顧客の残高が過少表示されていた。
--   さらに全件 select も PostgREST の db-max-rows(1000) を受けるため、DB側 SUM 集計に一本化する。
--
-- SECURITY INVOKER（既定）: service_role 呼び出しは RLS 迂回で全件 SUM、認証ユーザー呼び出しは
--   user_points の RLS（自分の行）に従う。他人の user_id を渡しても見える行が無く 0 となり情報漏洩しない。
CREATE OR REPLACE FUNCTION get_user_points_balance(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(points), 0)::int FROM user_points WHERE user_id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION get_user_points_balance TO anon, authenticated;

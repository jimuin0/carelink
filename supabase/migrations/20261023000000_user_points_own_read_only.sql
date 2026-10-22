-- CareLink ポイントの台帳（user_points）は本人だけが読める（2026年10月23日）。
--
-- 【問題】20260420000014 が作った user_points_facility_member_read は「自店に 1 件でも予約がある客か」
-- だけを見て、その客の台帳を全行読ませていた。台帳は全店共通なので、店舗の owner / admin は
-- 自分のトークンで PostgREST を直接叩けば（GET /rest/v1/user_points?user_id=eq.<客>）、
-- 他店での来店ポイント（支払額の目安と日時）・口コミポイント（どの店に口コミを書いたか）・
-- 予約での利用・誕生日ポイント（誕生月）まで読めた。
--
-- 【対処】このポリシーを消す。残る SELECT ポリシーは user_points_own_read（本人の行だけ）。
-- 書き込みポリシーは元から無い（書き込みは service_role の RPC／トリガだけ）。
--
-- このポリシーに頼る画面は無い（2026年10月23日に git grep で確認）:
--   * /mypage/points … ログイン本人として .eq('user_id', user.id) で自分の行だけを読む（own_read）
--   * /api/liff/points・/api/admin/backup・birthday-coupon cron … service_role（RLS の対象外）
--   * 残高は get_user_points_balance（本人以外は例外で弾く）
-- そのため本番への適用はアプリのデプロイの前後どちらでもよい（旧コードも壊れない）。
--
-- 将来、店舗にポイントを見せる場合は「その店舗の予約に紐づく行だけ」を返す service_role の API にし、
-- ブラウザ向けの SELECT ポリシーは戻さない。src/__tests__/user-points-own-read-only.test.ts が
-- migration を適用順に読み、user_points の SELECT ポリシーが own_read だけであることを CI で固定する。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

DROP POLICY IF EXISTS "user_points_facility_member_read" ON public.user_points;

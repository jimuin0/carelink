-- 店舗に口コミ投稿者の IP アドレス・アカウント ID を渡さない（2026年10月23日）。
--
-- 【問題】facility_reviews は anon / authenticated にテーブル単位の SELECT が付いていた。
-- RLS の facility_reviews_member_read は「自店の owner / admin なら自店の口コミを全行読める」で、
-- 列は絞れない（RLS は行しか絞れない）。そのため店舗は自分のトークンで PostgREST を直接叩くか、
-- /admin/reviews を開くだけで（旧画面は select('*')）、全投稿者の reviewer_ip・user_id・booking_id を
-- 受け取れた。user_id は自店の予約（bookings.user_id）と突き合わせられるので、ニックネームで
-- 書かれた口コミの投稿者を実名・電話番号まで特定できた。
-- 20260420000010 のコメントは「including ip for moderation」と店舗に IP を見せる理由を書いていたが、
-- 店舗側に IP を使う画面・処理は 1 つも無い（審査は service_role の cron と運営画面で行う）。
-- 口コミの公開ビュー public_reviews も user_id を出さず、真偽値 is_member だけを出している
-- （20261022130000）。店舗にだけ生の ID を渡す理由は無い。
--
-- 【対処】列レベルの GRANT にする。テーブル単位の SELECT を外し、本人確認に使える 4 列
-- （reviewer_ip・user_id・booking_id・client_operation_id）を除いた列だけを付け直す。
-- REVOKE SELECT はテーブルの全列の SELECT も一緒に外す（PostgreSQL の仕様）ので、残る列権限は
-- 下の GRANT だけになる。anon は RLS に読み取りポリシーが無く 1 行も読めない状態のまま、列も同じ一覧に揃える。
-- 店舗の「公開する／非表示にする」に要る UPDATE(status) と、WHERE に使う id・facility_id の SELECT は残る。
-- RLS のポリシー式（facility_reviews_own_read の user_id = auth.uid() など）は列権限の検査対象外なので、
-- ポリシーはそのまま働く。
--
-- 【読む側】ブラウザから facility_reviews を読む画面は次の 3 つだけだった（2026年10月23日 git grep）。
--   * /admin/reviews … 一覧は /api/admin/reviews（列を明示・運営の審査状態つき）に移した。
--     公開／非表示の切り替えは今までどおりブラウザから UPDATE(status)。
--   * /mypage/reviews・/mypage/reviews/[id]/edit … .eq('user_id', …) と select('*') を使っていたので、
--     この REVOKE の後は 42501 で失敗する。/api/review/mine（service_role・本人の行だけ）に移した。
-- 他の読み手は service_role（/api/review・cron・集計・バックアップ）か、所有者権限で動く
-- 公開ビュー public_reviews（security_invoker=false）なので、この GRANT の影響を受けない。
--
-- 列単位の GRANT は schema-fingerprint に記録されないので、src/__tests__/review-identity-column-grants.test.ts
-- が migration を適用順に読み、最後の付与が本人確認用の列を含まないことを CI で固定する。
-- 実 DB での確認は supabase/shadow/review-identity-columns-fixtures.sql。
--
-- 適用順: アプリのデプロイ【後】に適用する。デプロイ前のアプリ（origin/fix/fourth-sweep-integration）の
-- マイページは select('*') と .eq('user_id', …) で読むため、先に適用するとデプロイまで
-- 「投稿した口コミ」と口コミの編集画面が読み込みエラーになる。新しいアプリはこの GRANT の有無に
-- かかわらず動く。20261023120000 はデプロイの【前】。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

REVOKE SELECT ON public.facility_reviews FROM anon, authenticated;
GRANT SELECT (id, facility_id, reviewer_name, rating, rating_skill, rating_service, rating_atmosphere,
  rating_cleanliness, rating_explanation, comment, photo_urls, status, is_flagged, flag_reason,
  is_verified_visit, is_pickup, visit_date, staff_id, reply, replied_at, created_at)
  ON public.facility_reviews TO anon, authenticated;

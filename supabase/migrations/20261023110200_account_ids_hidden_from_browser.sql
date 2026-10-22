-- Q&A の質問者・回答者と「参考になった」を押した人のアカウント ID をブラウザのロールから隠す
-- （2026年10月23日）。2 本組の 2 本目。1 本目＝20261023110100_review_helpful_counts_rpc.sql。
--
-- 【穴】
--   * facility_qa: anon / authenticated は表単位の SELECT 権を持ち、公開読みポリシー
--     facility_qa_public_read（回答済み・公開）で行が見えるため、ログインなしで
--       GET /rest/v1/facility_qa?select=question,user_id,answered_by&status=eq.answered&is_public=eq.true
--     と、画面では名前を出していない質問者のアカウント ID（と回答した店舗スタッフの ID）が取れた。
--   * review_helpful: review_helpful_public_count（USING true）と anon の表単位の権限で、
--     全員の「参考になった」が押した人のアカウント ID つきで取れた。
--   アカウント ID はマイページのプロフィール写真の保存先（avatars/<ID>/avatar.<拡張子>・公開バケット）
--   でもあるので、匿名の質問を本人の顔写真と結び付けられた。アカウント ID は公開しない、という方針
--   （public_reviews は user_id を持たず is_member だけを出す・20261022130000）にも反していた。
--
-- 【対処】
--   * facility_qa: 表単位の SELECT を外し、画面が使う列だけを列単位で付け直す。
--     user_id / answered_by は service_role だけが読める（行の範囲は今のポリシーのまま）。
--   * review_helpful: 公開読みポリシーを消し、anon の権限を全て外す。authenticated は
--     review_helpful_user_manage（本人の行だけ）で、自分の押下の読み取り・追加・取り消しだけができる。
--     件数は 1 本目の get_review_helpful_counts（口コミ ID と件数だけを返す）で読む。
--
-- 🔴 本番の適用順序（1 本目と同時に適用しないこと）:
--   ① 1 本目（20261023110100）を適用（前後どちらでもよい）→ ② コードをデプロイ（マージ）→ ③ この migration。
--   この migration は旧コードの前提を壊す:
--     * 旧 /admin/qa は facility_qa を select('*') で読む。列単位の権限になると PostgREST の * は
--       permission denied になり、デプロイ前に適用すると、その間 Q&A 管理画面が読み込みエラーになる。
--     * 旧 ReviewList は review_helpful を直接読んで件数を数える。デプロイ前に適用すると、
--       その間は件数が 0（ログイン中なら自分の押下だけ）と表示される。
--   新コードは explicit な列の select と get_review_helpful_counts を使うので、適用の前後どちらでも動く。
--   🔴 `supabase db push` は保留中の migration を全部まとめて適用する。手順:
--   ① このファイルを含めない状態で push（20261023110000・20261023110100 だけを適用）
--   → ② コードをデプロイ → ③ このファイルを含めて push。
--   Dashboard の SQL Editor での直接適用は ADR-0005 で禁止（migration 経路から適用する）。
-- 実 DB での検証は supabase/shadow/featured-slots-account-ids-fixtures.sql（CI の schema-fingerprint）。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

-- facility_qa: 書き込み権は 20261022230100 / 20261022230300 で撤回済み（ここでは戻さない）。
-- テーブル単位の REVOKE は同じ権限の列単位 GRANT も外すので、直後に列単位で付け直す。
REVOKE SELECT ON public.facility_qa FROM anon, authenticated;
GRANT SELECT (id, facility_id, question, answer, status, is_public, created_at, answered_at)
  ON public.facility_qa TO anon, authenticated;

-- review_helpful: 本人の行だけを扱う review_helpful_user_manage はそのまま残す。
DROP POLICY IF EXISTS review_helpful_public_count ON public.review_helpful;
REVOKE ALL ON public.review_helpful FROM anon, authenticated;
GRANT SELECT, DELETE ON public.review_helpful TO authenticated;
GRANT INSERT (review_id, user_id) ON public.review_helpful TO authenticated;

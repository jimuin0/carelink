-- 口コミへの返信: ブラウザからの直接書き込みを閉じる（2026年10月22日）。
-- 2 本組の 2 本目。1 本目＝20261022140000_review_reply_edit_delete.sql（RPC の追加だけ）。
--
-- 返信の公開・編集・削除は /api/admin/review-replies → service_role 専用 RPC
-- （create / update / delete_review_reply_atomic）だけで行う。RPC の中で
-- 「今もその店舗の owner / admin か」・口コミの所属・1〜500 文字を書き込みと同時に確かめ、
-- API が監査ログを残す。ブラウザ（authenticated）から PostgREST を直接叩けば、
-- この確認も上限も監査ログも素通りできてしまうので、直接書き込みの経路を撤回する。
--
-- 🔴 本番の適用順序（1 本目と同時に適用しないこと）:
--   ① 1 本目（20261022140000）を適用 → ② コードをデプロイ（マージ）→ ③ この migration を適用。
--   この migration は「旧コード（ブラウザから review_replies へ INSERT）」の前提を壊す。
--   コードのデプロイ前に適用すると、その間は返信の投稿が必ず失敗する。デプロイ後なら、
--   影響は古い画面を開いたままのタブだけ（投稿が「返信に失敗しました」になり、再読み込みで直る。
--   データは壊れない）。
--
-- 公開読み取り（review_replies_public_read＝FOR SELECT USING (true)）はそのまま残す。
-- 店舗ページと管理画面は引き続きブラウザから返信を読む（編集・削除は次の表示で反映される）。
-- INSERT 権を撤回したうえでポリシーも消す（どちらか片方が戻っても開かない＝二重に閉じる）。
-- テーブル単位の REVOKE は、同じ権限の列単位の GRANT も一緒に外す（PostgreSQL の仕様）。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

REVOKE INSERT, UPDATE, DELETE ON public.review_replies FROM anon, authenticated;
DROP POLICY IF EXISTS review_replies_facility_member_insert ON public.review_replies;

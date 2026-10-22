-- 施設 Q&A: ブラウザからの質問の直接 INSERT を閉じる（2026年10月22日）。
-- 2 本組の 2 本目。1 本目＝20261022230100_facility_qa_question_only.sql。
--
-- 質問は POST /api/facility/qa（ログイン必須・CSRF・レート制限）がサーバーで保存し、
-- 保存できたらその店舗の owner / admin へメールで知らせる。ブラウザから PostgREST へ
-- 直接 INSERT できるままだと、通知もレート制限も通らない質問が作れてしまう
-- （店舗が気づかないまま未回答で残る＝この修正の目的そのものが崩れる）ので、経路を 1 本にする。
--
-- 🔴 本番の適用順序（1 本目と同時に適用しないこと）:
--   ① 1 本目（20261022230100）を適用 → ② コードをデプロイ（マージ）→ ③ この migration を適用。
--   この migration は「旧コード（QASection.tsx がブラウザから facility_qa へ INSERT）」の前提を壊す。
--   デプロイ前に適用すると、その間は質問の投稿が必ず失敗する（「質問の送信に失敗しました」）。
--   デプロイ後なら、影響は古い画面を開いたままのタブだけ（再読み込みで直る。データは壊れない）。
--   🔴 `supabase db push` は保留中の migration を全部まとめて適用する。この PR の 4 本
--   （20261022230000〜20261022230300）を一度の push で流すと、この 1 本までデプロイ前に入る。
--   手順: ① このファイルを含めない状態で push（20261022230000〜20261022230200 だけを適用）
--   → ② コードをデプロイ → ③ このファイルを含めて push。
--   Dashboard の SQL Editor での直接適用は ADR-0005 で禁止（migration 経路から適用する）。
--
-- INSERT 権を撤回したうえでポリシーも消す（どちらか片方が戻っても開かない＝二重に閉じる）。
-- テーブル単位の REVOKE は、同じ権限の列単位の GRANT（1 本目の INSERT (5 列)）も一緒に外す
-- （PostgreSQL の仕様）。読み取り（公開ページ・管理画面）はそのまま残る。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

REVOKE INSERT ON public.facility_qa FROM anon, authenticated;
DROP POLICY IF EXISTS facility_qa_user_insert ON public.facility_qa;

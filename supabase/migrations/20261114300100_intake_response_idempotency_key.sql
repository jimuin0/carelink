-- 問診票の送信に冪等キーを付ける（点検 B6-6・2026年11月14日）。
--
-- 【それまでの状態】/api/intake は送信のたびに intake_form_responses へ 1 行 INSERT していた。
-- 応答前の二重クリックや、通信が切れて送り直したときに同じ回答が 2 件できた。
--
-- 【この migration で入れるもの】
--   idempotency_key uuid（NULL 可・UNIQUE）。フォームは表示ごとに 1 つの UUID を作って送り、
--   API は一意違反なら既に保存した行を返す（2 件目を作らない）。
--   既存行は NULL のまま（UNIQUE は NULL 同士を区別するので既存データに影響しない）。
--   書き込みは service_role の API だけ（ブラウザの INSERT 権は 20260604000003 等で撤回済み）なので
--   GRANT は変えない。
--
-- 【本番の適用順序】この migration を適用 → コードをデプロイ。
--   コードを先に出すと、無い列への INSERT で問診票の送信が 500 になる。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

ALTER TABLE public.intake_form_responses ADD COLUMN IF NOT EXISTS idempotency_key uuid;
ALTER TABLE public.intake_form_responses
  ADD CONSTRAINT intake_form_responses_idempotency_key_key UNIQUE (idempotency_key);

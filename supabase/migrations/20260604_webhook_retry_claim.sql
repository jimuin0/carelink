-- Webhook リトライキューのアトミック claim 化＋孤児回収（スケール監査 #5 根本対策）
--
-- 事実: webhook-retry cron は ①pending を SELECT → ②id を processing に UPDATE の2段 claim で、
--   UPDATE に status='pending' ガードが無く SELECT との間に窓があった（並行実行で二重配信し得た）。
--   また processing にした後にプロセスが落ちると、その行は永久に processing で残り、次回 cron は
--   pending しか拾わないため二度と再送されず通知が静かに永久喪失していた。
--
-- 対策（delivered_at を「配信済み(不可逆)」の唯一の権威にして再送可否を分離）:
--   - claimed_at: いつ claim したか。reaper が「古い processing 孤児」を判定するために使う。
--   - delivered_at: 外部送信が成功した瞬間に stamp。これ以降 processing で残っても reaper は再送せず success 化。
--   アプリ側は claim を `UPDATE ... WHERE status='pending' AND id IN(...) RETURNING` に変更し、
--   実際に掴めた行だけ処理する（claim race 由来の二重配信を構造的に封鎖）。
ALTER TABLE webhook_retry_queue ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE webhook_retry_queue ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- 既存の processing バックログを一括解放（このマイグレーション適用時点で能動処理中の行は無い前提）。
-- 列追加前から残っていた孤児（claimed_at が NULL）を pending に戻し、新ロジックの reaper 管理下に置く。
UPDATE webhook_retry_queue SET status = 'pending' WHERE status = 'processing';

-- reaper の processing 走査を高速化
CREATE INDEX IF NOT EXISTS idx_webhook_retry_processing
  ON webhook_retry_queue (claimed_at)
  WHERE status = 'processing';

-- 外部送信後に Supabase 更新結果が不明でも、stale reclaim による二重配信を起こさない。
-- 外部 API を呼ぶ直前に delivery_started_at を確定し、同列が残る processing 行は
-- 自動再送せず運用照合に留める。既存行は NULL のため従来どおり孤児 reclaim の対象となる。

ALTER TABLE public.webhook_retry_queue
  ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_webhook_retry_processing_unstarted
  ON public.webhook_retry_queue USING btree (claimed_at)
  WHERE status = 'processing' AND delivery_started_at IS NULL;

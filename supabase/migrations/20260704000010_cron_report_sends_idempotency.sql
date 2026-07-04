-- ============================================================================
-- M-1 根治: 日次/週次レポートメールの二重送信を防ぐ冪等 claim テーブル（2026年7月4日）
--
-- 【背景】GitHub Actions cron.yml と Render cron は同一の /api/cron/* を同一スケジュールで
-- 二重発火する構成（render.yaml が「GitHub Actions は public repo で最大176分間引かれるため
-- Render を定刻発火の主とし、cron.yml は冗長化のため残す」と明記）。この二重化は各エンドポイントが
-- 冪等であることを前提とする。実際、送信系 cron は全て claim-before-send の冪等ガードを持つ
-- （booking-reminder=sent_reminders・review-request/onboarding-followup=*_sent_at CAS・
-- favorites-digest=favorites_digest_sent_week・birthday-coupon=birthday_YYYY unique index 等）。
-- ところが後発のメールレポート2種（daily-summary・weekly-report）だけ冪等ガードが無く、施設
-- オーナーへ日次/週次サマリーメールが2通届いていた（GitHub と Render の両発火・176分ずれても再発）。
--
-- 【対策（発症前予防）】(job, facility_id, period_key) を claim してから送信する汎用テーブルを設ける。
-- period_key は daily='YYYY-MM-DD'、weekly='<start>..<end>'。UNIQUE 制約で二重発火の2本目の
-- INSERT を 23505 で弾き、その run は送信せずスキップする。送信失敗時は claim を解放し翌 run で
-- 再送できるようにする（sent_reminders / onboarding-followup と同型）。
-- ============================================================================
CREATE TABLE IF NOT EXISTS cron_report_sends (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job         TEXT NOT NULL,
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  period_key  TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cron_report_sends_uniq UNIQUE (job, facility_id, period_key)
);

-- service_role（cron）のみが書き込む。anon/authenticated は全拒否（sent_reminders と同方針）。
ALTER TABLE cron_report_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no_access" ON cron_report_sends; -- 再適用安全化
CREATE POLICY "no_access" ON cron_report_sends AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

CREATE INDEX IF NOT EXISTS cron_report_sends_sent_at_idx ON cron_report_sends (sent_at);

-- 保持: 90日超の claim 行は dedup 用途を終えている（daily/weekly の period はとうに過ぎている）ため
-- 日次で削除し無期限増殖を防ぐ（cron_logs_cleanup と同じ graceful パターン）。
CREATE OR REPLACE FUNCTION cleanup_old_cron_report_sends()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM cron_report_sends WHERE sent_at < now() - INTERVAL '90 days';
$$;
REVOKE EXECUTE ON FUNCTION cleanup_old_cron_report_sends() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cron-report-sends-cleanup',
      '40 18 * * *', -- 毎日 18:40 UTC（cron-logs-cleanup 18:30 と衝突回避）
      $cleanup$SELECT cleanup_old_cron_report_sends()$cleanup$
    );
  ELSE
    RAISE NOTICE 'pg_cron not enabled - cron_report_sends cleanup must be scheduled manually';
  END IF;
END $$;

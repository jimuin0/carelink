-- Keep anonymous chat quota buckets for the entire rolling 24-hour window.
-- The existing hourly cleanup otherwise erased these counters after one hour,
-- silently allowing the paid-provider quota to reset early.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'rate-limit-cleanup',
      '0 * * * *',
      $cleanup$
        DELETE FROM rate_limit_buckets
        WHERE (key LIKE 'chat-daily:%' AND window_start < NOW() - INTERVAL '25 hours')
           OR (key NOT LIKE 'chat-daily:%' AND window_start < NOW() - INTERVAL '1 hour')
      $cleanup$
    );
  ELSE
    RAISE NOTICE 'pg_cron not enabled - rate_limit_buckets cleanup must be scheduled manually';
  END IF;
END $$;

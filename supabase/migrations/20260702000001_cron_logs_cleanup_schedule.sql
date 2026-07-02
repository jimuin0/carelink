-- C-1 根治: cleanup_old_cron_logs()（20260417000010_cron_logs.sql で定義済み）は
-- 「30日で自動削除」とテーブルコメントに明記されているが、これを呼び出す pg_cron
-- スケジュールが一度も登録されておらず完全なデッドコードだった（呼び出し元ゼロを
-- grep で確認済み）。webhook-retry(15分毎)・毎時ジョブ等により cron_logs は
-- 無期限に増殖し続ける（発症前予防の欠落）。
--
-- rate-limit-cleanup(20260526000005) と同じパターンで、pg_cron が有効なプロジェクト
-- でのみ毎日 1 回スケジュール登録する（未有効でも本 migration は失敗しない）。
-- cron.schedule は同名ジョブ名なら既存ジョブを更新するため、再適用しても安全（冪等）。

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cron-logs-cleanup',
      '30 18 * * *', -- 毎日 18:30 UTC（JST 03:30・他 cron の衝突を避けた時間帯）
      $cleanup$SELECT cleanup_old_cron_logs()$cleanup$
    );
  ELSE
    RAISE NOTICE 'pg_cron not enabled - cron_logs cleanup must be scheduled manually';
  END IF;
END $$;

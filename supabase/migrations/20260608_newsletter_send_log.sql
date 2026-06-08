-- newsletter-digest を exactly-once 化するための送信台帳。
--
-- 背景（根本原因）: 月次ニュースレター newsletter-digest は GitHub Actions の best-effort
-- スケジュールに依存しており、単一 tick `0 16 1 * *` がドロップすると当月分が永久未送信になる
-- （2026-06 実際に未送信になった）。対策として専用 workflow で複数日(1〜7日)に self-heal 再試行する。
--
-- その再試行・同時実行で「二重送信」しないよう、(period, email) を主キーとする送信台帳を導入し、
-- 「当月そのアドレスへ送信済みか」を永続記録する。送信は決定的 idempotency key と併用し、
-- 台帳記録前のクラッシュ時の再送も Resend 側で重複排除する（exactly-once）。
--
-- period は配信対象月 'YYYY-MM'(UTC)。campaign_id は監査用（必須ではない）。
CREATE TABLE IF NOT EXISTS newsletter_send_log (
  period TEXT NOT NULL,
  email TEXT NOT NULL,
  campaign_id UUID REFERENCES newsletter_campaigns(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period, email)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_send_log_period ON newsletter_send_log(period);

-- service_role のみアクセス（cron からの書き込み）。RLS 有効＋ポリシー未定義により
-- anon/authenticated は全拒否、service_role は RLS をバイパスして読み書きできる。
ALTER TABLE newsletter_send_log ENABLE ROW LEVEL SECURITY;

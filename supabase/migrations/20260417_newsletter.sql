-- ニュースレター管理テーブル
-- 施設オーナー向け月次ニュースレター + ユーザー向けメルマガ

CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_type TEXT NOT NULL CHECK (campaign_type IN ('owner_monthly', 'user_digest', 'user_coupon', 'promo')),
  subject TEXT NOT NULL,
  html_content TEXT NOT NULL,
  text_content TEXT,
  target_segment JSONB DEFAULT '{}',  -- フィルター条件
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  stats JSONB DEFAULT '{"sent": 0, "opened": 0, "clicked": 0, "bounced": 0}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  subscription_type TEXT NOT NULL CHECK (subscription_type IN ('owner_monthly', 'user_digest', 'all')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  unsubscribed_at TIMESTAMPTZ,
  source TEXT DEFAULT 'signup',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_status ON newsletter_campaigns(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_newsletter_subs_user ON newsletter_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_subs_email ON newsletter_subscriptions(email);

ALTER TABLE newsletter_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_subscriptions ENABLE ROW LEVEL SECURITY;

-- プラットフォーム管理者のみキャンペーンを操作
CREATE POLICY "newsletter_campaigns_admin" ON newsletter_campaigns
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND is_platform_admin = TRUE
    )
  );

-- ユーザーは自分のサブスクリプションのみ
CREATE POLICY "newsletter_subs_own" ON newsletter_subscriptions
  FOR ALL USING (user_id = auth.uid());

-- メール配信停止（v8.17）
-- CAN-SPAM / 特商法対応: ユーザーがメール配信を停止できる

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email_unsubscribed BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_unsubscribed
  ON profiles(email_unsubscribed)
  WHERE email_unsubscribed = TRUE;

-- 配信停止トークンテーブル（トークン署名で本人確認）
CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_unsubscribe_tokens_user
  ON email_unsubscribe_tokens(user_id);

ALTER TABLE email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

-- トークンは匿名でも参照・更新可（配信停止ページはサインイン不要）
CREATE POLICY "anon_read_token" ON email_unsubscribe_tokens FOR SELECT
  USING (true);

CREATE POLICY "anon_update_token" ON email_unsubscribe_tokens FOR UPDATE
  USING (true) WITH CHECK (true);

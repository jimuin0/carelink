-- 問い合わせチケット管理（v8.38）
-- contacts テーブルにチケット管理フィールドを追加
-- ステータス管理・担当者割当・返信記録を実装

-- contacts テーブルへのチケット管理カラム追加
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ticket_status  TEXT NOT NULL DEFAULT 'open'
    CHECK (ticket_status IN ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
  ADD COLUMN IF NOT EXISTS priority       TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS assigned_to    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ticket_notes   TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_ticket_status ON contacts (ticket_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_priority ON contacts (priority, ticket_status);

-- チケット返信履歴テーブル
CREATE TABLE IF NOT EXISTS contact_replies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  author_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name  TEXT NOT NULL DEFAULT '担当者',
  body         TEXT NOT NULL,
  is_internal  BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE=内部メモ、FALSE=顧客への返信
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_replies_contact ON contact_replies (contact_id, created_at);

-- RLS
ALTER TABLE contact_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contact_replies_facility_member" ON contact_replies FOR ALL USING (
  EXISTS (
    SELECT 1 FROM contacts c
    JOIN facility_members fm ON fm.user_id = auth.uid()
    WHERE c.id = contact_replies.contact_id
  )
);

COMMENT ON TABLE contact_replies IS '問い合わせチケットへの返信・内部メモ。is_internal=TRUEは顧客に送信しない内部メモ。';
COMMENT ON COLUMN contacts.ticket_status IS 'open=新着, in_progress=対応中, waiting=返信待ち, resolved=解決済み, closed=クローズ';

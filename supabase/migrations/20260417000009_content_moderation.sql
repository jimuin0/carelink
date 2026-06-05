-- コンテンツモデレーション（v8.37）
-- 写真・レビュー・QA等のユーザー投稿コンテンツの審査フロー管理

CREATE TABLE IF NOT EXISTS moderation_queue (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type   TEXT NOT NULL CHECK (content_type IN ('review', 'photo', 'qa_answer', 'blog_comment')),
  content_id     UUID NOT NULL,
  facility_id    UUID REFERENCES facility_profiles(id) ON DELETE CASCADE,
  reporter_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  report_reason  TEXT,
  auto_flags     JSONB DEFAULT '[]',  -- 自動検知フラグ（同一IP・短時間大量投稿等）
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'escalated')),
  reviewed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  review_note    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_status ON moderation_queue (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_content ON moderation_queue (content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_moderation_facility ON moderation_queue (facility_id) WHERE facility_id IS NOT NULL;

-- RLS
ALTER TABLE moderation_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "moderation_admin_all" ON moderation_queue FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- facility_reviews に is_flagged / flag_reason は既に20260417_review_flagging.sql で追加済み
-- facility_photos へのフラグカラムを追加
ALTER TABLE facility_photos
  ADD COLUMN IF NOT EXISTS is_flagged   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flag_reason  TEXT,
  ADD COLUMN IF NOT EXISTS flagged_at   TIMESTAMPTZ;

COMMENT ON TABLE moderation_queue IS 'ユーザー投稿コンテンツの審査キュー。通報・自動フラグ・管理者承認フロー。';

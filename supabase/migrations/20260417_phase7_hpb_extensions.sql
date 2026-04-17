-- Phase 7: HPB超え拡張（6テーブル + facility_reviews カラム追加）
-- feature_articles / facility_qa / chat_rooms / chat_messages / user_preferred_staff / review_helpful
-- ALTER facility_reviews: is_verified_visit / photo_urls

-- ============================================================
-- 1. feature_articles（特集記事）
-- ============================================================
CREATE TABLE IF NOT EXISTS feature_articles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  subtitle     TEXT,
  image_url    TEXT,
  href         TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE feature_articles ENABLE ROW LEVEL SECURITY;

-- 公開中の記事は誰でも読める
CREATE POLICY "feature_articles_public_read" ON feature_articles
  FOR SELECT USING (is_active = TRUE);

-- ============================================================
-- 2. facility_qa（施設Q&A）
-- ============================================================
CREATE TABLE IF NOT EXISTS facility_qa (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id   UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  question      TEXT NOT NULL,
  answer        TEXT,
  answered_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered')),
  is_public     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE facility_qa ENABLE ROW LEVEL SECURITY;

-- 公開済み回答は誰でも読める
CREATE POLICY "facility_qa_public_read" ON facility_qa
  FOR SELECT USING (is_public = TRUE AND status = 'answered');

-- 施設メンバーは自施設の全Q&Aを操作できる
CREATE POLICY "facility_qa_member_all" ON facility_qa
  FOR ALL USING (
    facility_id IN (
      SELECT facility_id FROM facility_members WHERE user_id = auth.uid()
    )
  );

-- ログイン済みユーザーは自分の質問を投稿できる
CREATE POLICY "facility_qa_user_insert" ON facility_qa
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- ============================================================
-- 3. chat_rooms（チャットルーム）
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_rooms (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id      UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (facility_id, user_id)
);

ALTER TABLE chat_rooms ENABLE ROW LEVEL SECURITY;

-- 施設メンバーは自施設のルームを操作できる
CREATE POLICY "chat_rooms_member" ON chat_rooms
  FOR ALL USING (
    facility_id IN (
      SELECT facility_id FROM facility_members WHERE user_id = auth.uid()
    )
  );

-- ユーザーは自分のルームを読める
CREATE POLICY "chat_rooms_user_read" ON chat_rooms
  FOR SELECT USING (user_id = auth.uid());

-- ============================================================
-- 4. chat_messages（チャットメッセージ）
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL CHECK (char_length(content) <= 1000),
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- ルーム参加者（施設メンバーorルームオーナー）はメッセージを操作できる
CREATE POLICY "chat_messages_participant" ON chat_messages
  FOR ALL USING (
    room_id IN (
      SELECT id FROM chat_rooms
      WHERE user_id = auth.uid()
         OR facility_id IN (
               SELECT facility_id FROM facility_members WHERE user_id = auth.uid()
            )
    )
  );

-- Supabase Realtime用インデックス
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON chat_messages (room_id, created_at);

-- ============================================================
-- 5. user_preferred_staff（指名スタッフ登録）
-- ============================================================
CREATE TABLE IF NOT EXISTS user_preferred_staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id    UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, staff_id)
);

ALTER TABLE user_preferred_staff ENABLE ROW LEVEL SECURITY;

-- 自分の指名スタッフのみ操作できる
CREATE POLICY "user_preferred_staff_owner" ON user_preferred_staff
  FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- 6. review_helpful（口コミ「役に立った」）
-- ============================================================
CREATE TABLE IF NOT EXISTS review_helpful (
  review_id   UUID NOT NULL REFERENCES facility_reviews(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (review_id, user_id)
);

ALTER TABLE review_helpful ENABLE ROW LEVEL SECURITY;

-- 口コミ件数は誰でも確認できる（集計用）
CREATE POLICY "review_helpful_public_count" ON review_helpful
  FOR SELECT USING (TRUE);

-- ログイン済みユーザーが自分の「役に立った」を管理できる
CREATE POLICY "review_helpful_user_manage" ON review_helpful
  FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- 7. ALTER TABLE facility_reviews（口コミ拡張）
-- ============================================================
ALTER TABLE facility_reviews
  ADD COLUMN IF NOT EXISTS is_verified_visit BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[];

-- ============================================================
-- インデックス
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_facility_qa_facility_id ON facility_qa (facility_id, status);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_facility_id  ON chat_rooms  (facility_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_user_id      ON chat_rooms  (user_id);
CREATE INDEX IF NOT EXISTS idx_review_helpful_review   ON review_helpful (review_id);
CREATE INDEX IF NOT EXISTS idx_feature_articles_sort   ON feature_articles (sort_order, is_active);
CREATE INDEX IF NOT EXISTS idx_user_preferred_staff    ON user_preferred_staff (user_id);

-- ============================================================
-- Realtime: chat_messages を有効化
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- ============================================================
-- GRANT
-- ============================================================
GRANT SELECT ON feature_articles      TO anon, authenticated;
GRANT SELECT ON facility_qa           TO anon, authenticated;
GRANT SELECT ON chat_rooms            TO authenticated;
GRANT SELECT, INSERT, UPDATE ON chat_messages     TO authenticated;
GRANT SELECT, INSERT, DELETE ON review_helpful    TO authenticated;
GRANT SELECT, INSERT, DELETE ON user_preferred_staff TO authenticated;
GRANT INSERT, UPDATE ON facility_qa   TO authenticated;

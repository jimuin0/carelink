-- ============================================================
-- Security: facility_reviews UPDATE policy + chat_rooms GRANT
-- 2026-04-18
-- ============================================================

-- 1. facility_reviews: 施設メンバーは自施設のレビューを更新できる（hide/show）
--    ※ 削除は行わない（サービスロール経由の cron のみ）
CREATE POLICY IF NOT EXISTS "facility_reviews_member_update"
  ON facility_reviews FOR UPDATE
  USING (
    facility_id IN (
      SELECT facility_id FROM facility_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    facility_id IN (
      SELECT facility_id FROM facility_members WHERE user_id = auth.uid()
    )
  );

-- 2. facility_reviews: プラットフォーム管理者は全件更新できる
CREATE POLICY IF NOT EXISTS "facility_reviews_admin_update"
  ON facility_reviews FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (true);

-- 3. GRANT UPDATE 権限を付与（認証済みユーザー）
GRANT UPDATE ON facility_reviews TO authenticated;

-- 4. chat_rooms: ユーザーは自分のルームを更新できる（last_message_at 更新用）
CREATE POLICY IF NOT EXISTS "chat_rooms_user_update"
  ON chat_rooms FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 5. GRANT UPDATE 権限を付与
GRANT UPDATE ON chat_rooms TO authenticated;

-- PostgREST スキーマキャッシュリロード
NOTIFY pgrst, 'reload schema';

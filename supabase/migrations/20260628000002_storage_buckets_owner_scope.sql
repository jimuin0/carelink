-- Storage バケット/ポリシーの所有者スコープ化（本番へ適用済みの内容を記録）。
--
-- 背景(事実・本番 pg_policies / storage.buckets を調査して確定):
--   ・photos バケットが本番に存在せず、作成マイグレーションも無かった。admin/photos の
--     アップロードは "Bucket not found" で必ず失敗していた（施設写真追加の機能不全）。
--   ・avatars の INSERT は所有者スコープ無しの緩いポリシー（誰でも任意パスへ書込可）で、
--     UPDATE ポリシーが無く upsert:true の本人再アップロードも失敗していた。
--   ・carelink-uploads は bucket の allowed_mime_types が無制限で、登録前 anon が SVG/HTML を
--     アップロードでき public URL 配信で XSS 可能だった。
--   ・既存マイグレーション 20260420000011 は所有者スコープ無しの旧ポリシーを作るため、
--     本番(手動作成の avatars_auth_insert 等)・ローカル(20260420000011 の名前)の双方を
--     掃除してから所有者スコープ版を作る。
-- 修正: photos バケット作成＋施設メンバースコープ、avatars 所有者スコープ(INSERT/UPDATE)、
--   carelink-uploads の画像 MIME 限定。public read は public バケットのため不要。

-- ── (B) photos: バケット作成＋施設メンバー(owner/admin)スコープ INSERT ──────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('photos', 'photos', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 旧ポリシー(マイグレ名・本番名)を掃除してから所有者スコープ版を作成（冪等）
DROP POLICY IF EXISTS "Allow authenticated upload photos" ON storage.objects;
DROP POLICY IF EXISTS "photos_insert_facility_admin" ON storage.objects;
CREATE POLICY "photos_insert_facility_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = 'facilities'
    AND EXISTS (
      SELECT 1 FROM public.facility_members fm
      WHERE fm.facility_id::text = (storage.foldername(name))[2]
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner','admin')
    )
  );

-- ── (C) avatars: 所有者スコープの INSERT/UPDATE に置換 ─────────────────────────────
-- 緩い INSERT を掃除（マイグレ名 "Allow authenticated upload avatars" / 本番名 avatars_auth_insert）
DROP POLICY IF EXISTS "Allow authenticated upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;

CREATE POLICY "avatars_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── (D) carelink-uploads: bucket レベルで画像 MIME を限定（anon の XSS 投稿を根治）──────
-- register が扱う画像のみ（jpeg/png/webp/gif）。bucket 未作成環境では 0 行更新で無害。
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif']
WHERE id = 'carelink-uploads';

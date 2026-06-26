-- facility_photos の owner/admin 書き込み(INSERT/UPDATE/DELETE)を可能にする RLS + GRANT。
--
-- 背景(事実): facility_photos は RLS 有効だが SELECT ポリシー（公開read / authenticated read）
--   のみ存在し、GRANT も `GRANT SELECT ... TO authenticated` だけだった。
--   一方 admin 写真管理画面(src/app/admin/photos/page.tsx)はブラウザの authenticated セッションで
--   facility_photos に直接 .insert() / .delete() している。INSERT/DELETE のポリシーもテーブル権限も
--   無いため、施設オーナーの写真追加・削除が RLS とテーブル権限の両方で拒否され機能していなかった。
-- 修正: 当該施設の facility_members(role owner/admin) に属する authenticated ユーザーにのみ
--   INSERT/UPDATE/DELETE を許可するポリシーを追加し、対応する GRANT を付与する。
--   公開readは既存ポリシーのまま（変更なし）。

GRANT INSERT, UPDATE, DELETE ON public.facility_photos TO authenticated;

DROP POLICY IF EXISTS "owner_admin_insert_photos" ON public.facility_photos;
CREATE POLICY "owner_admin_insert_photos" ON public.facility_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility_members m
      WHERE m.facility_id = facility_photos.facility_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "owner_admin_update_photos" ON public.facility_photos;
CREATE POLICY "owner_admin_update_photos" ON public.facility_photos
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility_members m
      WHERE m.facility_id = facility_photos.facility_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility_members m
      WHERE m.facility_id = facility_photos.facility_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "owner_admin_delete_photos" ON public.facility_photos;
CREATE POLICY "owner_admin_delete_photos" ON public.facility_photos
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility_members m
      WHERE m.facility_id = facility_photos.facility_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

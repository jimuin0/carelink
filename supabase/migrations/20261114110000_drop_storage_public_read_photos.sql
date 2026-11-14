-- 本番に合わせ、storage.objects のポリシー「Public read photos」を撤去する（2026年11月14日）。
--
-- 作成元: supabase/migrations/20260420000011_storage_image_only.sql
--   CREATE POLICY "Public read photos" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'photos');
--
-- 本番の実測ではこのポリシーは存在しない（migration と本番のずれ）。photos バケットは public 設定のため、
-- 公開 URL（/storage/v1/object/public/photos/...）での画像表示にこのポリシーは要らない。
-- 逆にこれがあると anon が storage.objects を SELECT でき、photos バケットのファイル一覧を取得できる。
-- 本番では DROP POLICY IF EXISTS により何もしない（no-op）。新しく作る環境だけが本番と揃う。
--
-- 注意: public.facility_photos にある同名のポリシー（20260321000004）は別物で、ここでは触らない。
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION
      'このデータベースは CareLink ではありません（public.facility_profiles が存在しない）。'
      ' 接続先プロジェクトを確認してください。CareLink の本番 ref は xzafxiupbflvgbarrihe です。';
  END IF;
END
$guard$;

DROP POLICY IF EXISTS "Public read photos" ON storage.objects;

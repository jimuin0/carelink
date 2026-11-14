-- 点検 A280（2026年11月14日）：20260321000004_facilities_phase1.sql が架空の公開施設 10 件
-- （と Unsplash の写真 URL）を入れるため、新しく作る環境（CI・staging 再構築）に必ず架空施設が載っていた。
-- 適用済みの migration は書き換えず、ここで消す。メニュー・写真など子行は FK の ON DELETE CASCADE に任せる。
--
-- 🔴 本番には 10 件とも存在しない（確認済み）ので本番では 0 行削除の no-op。
--    万一、実在の店舗が同じ slug を後から使っていても消さないよう、slug だけでなく
--    「シードと同じ施設名」「写真が Unsplash のまま」「店舗メンバー（facility_members）がいない」
--    の全部を満たす行だけを消す（実店舗は登録時に必ず owner の facility_members を持つ）。
-- スキーマは変えない（schema-fingerprint の期待値は変わらない）。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

DELETE FROM public.facility_profiles p
USING (VALUES
  ('hal-eyelash-sakai', 'HAL eyelash salon 堺東店'),
  ('hair-bloom-namba', 'hair design BLOOM 難波店'),
  ('karada-shinkyuin-honmachi', 'からだ鍼灸院 本町'),
  ('sukoyaka-tennoji', 'すこやか鍼灸整体院 天王寺'),
  ('sakura-seikotsuin-umeda', 'さくら整骨院 梅田'),
  ('active-seikotsuin-shinsaibashi', 'スポーツ整骨院アクティブ 心斎橋'),
  ('day-service-himawari-sakai', 'デイサービスひまわり 堺中区'),
  ('care-home-yasuragi-higashiosaka', 'ケアホームやすらぎ 東大阪'),
  ('naika-hifuka-clinic-sakai', '内科・皮膚科クリニック さかい'),
  ('glow-clinic-umeda', '美容皮膚科 GLOW CLINIC 梅田')
) AS seed(slug, name)
WHERE p.slug = seed.slug
  AND p.name = seed.name
  AND p.main_photo_url LIKE 'https:%'
  AND split_part(p.main_photo_url, '/', 3) = 'images.unsplash.com'
  AND NOT EXISTS (SELECT 1 FROM public.facility_members m WHERE m.facility_id = p.id);

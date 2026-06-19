-- facility_menus に HPB 由来メニューの紐付け列 hpb_ref_id を追加。
-- /admin/hpb-menus の「facility_menus へ一括反映」(PR4) が、hpb_menu_durations の
-- 各行(ref_id)を facility_menus へ反映する際、再反映で二重作成しないための目印。
-- (facility_id, hpb_ref_id) の部分 UNIQUE 制約で「1施設につき同一HPBメニューは1行」を
-- 物理的に保証する(hpb_ref_id IS NULL の手入力メニューは制約対象外)。
ALTER TABLE facility_menus
  ADD COLUMN IF NOT EXISTS hpb_ref_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS facility_menus_hpb_ref_uniq
  ON facility_menus (facility_id, hpb_ref_id)
  WHERE hpb_ref_id IS NOT NULL;

-- 2026-06-29: facility_menus の本番先行列を migration へ catch-up し、fresh-apply
--   （supabase start＝CI / E2E / Vercel プレビュー / ローカルのローカル DB）が本番を忠実に
--   再現できるようにする（冪等・無破壊・本番では no-op）。
--
-- 背景（事実・実データで確定）:
--   facility_menus は 20260321000004_facilities_phase1.sql で is_published 等を持たない形で
--   CREATE され、後続の prod_only_base_tables.sql 等の `CREATE TABLE IF NOT EXISTS` は
--   テーブル既存のため no-op になり、本番に out-of-band 追加された列が fresh-apply に反映
--   されていなかった。来院者 予約完走 E2E（supabase start のローカル DB に対して実行）で
--   「Could not find the 'is_published' column of 'facility_menus'」が出たのはこのドリフトが原因。
--   getFacilityMenus（src/lib/facilities.ts）は `is_published.is.null,is_published.eq.true` で
--   この列を参照するため、列欠落で予約ページのメニュー取得が壊れていた（preview でも実害）。
--
--   本番（ref: xzafxiupbflvgbarrihe）の information_schema.columns 実測 DDL（神原さん確認）:
--     | column_name      | data_type | is_nullable | column_default |
--     | photo_url        | text      | YES         | null           |
--     | subcategory      | text      | YES         | null           |
--     | search_category  | text      | YES         | null           |
--     | reservable       | boolean   | YES         | true           |
--     | is_published     | boolean   | YES         | true           |
--     | price_show_tilde | boolean   | YES         | false          |
--     | price_ask        | boolean   | YES         | false           |
--     | hpb_ref_id       | text      | YES         | null           |
--   （insurance_covered / insurance_note / insurance_price は既存 migration で追加済みのため対象外）
--
--   src/lib/schema-snapshot.json（本番 introspection の正）には上記列が含まれており、是正すべきは
--   migration 側。型・snapshot は無変更。
--
-- 冪等性・無破壊: ADD COLUMN IF NOT EXISTS のみ。本番（列が既に存在）では完全な no-op。
--   fresh-apply では本番と同一の型・default で列が追加され、fresh-apply == 本番 が成立する。

ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS subcategory TEXT;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS search_category TEXT;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS reservable BOOLEAN DEFAULT true;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS price_show_tilde BOOLEAN DEFAULT false;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS price_ask BOOLEAN DEFAULT false;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS hpb_ref_id TEXT;

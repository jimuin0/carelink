-- 2026-06-22: bookings.menu_ids 列を追加（冪等・スキーマ再構築時の欠落予防）。
--
-- 背景（事実・8体監査の追検証で確定）:
--   複数メニュー予約は create_booking_atomic が p_menu_id(単一)しか受けないため、
--   bookings.menu_ids 配列に全メニューを別UPDATEで保存している
--   （src/app/api/booking/route.ts・src/app/api/admin/bookings/route.ts、PR#225 で配線）。
--   この menu_ids 列は本番DBには既に存在し（PR#225 が「本番反映済み」と明記）、
--   src/types/database.types.ts・src/lib/schema-snapshot.json にも反映済み。
--   しかし supabase/migrations/ に列を作成する DDL が一度も無かったため、
--   新環境・CI・DB再構築（migration からの clean rebuild）では menu_ids 列が生成されず、
--   複数メニューの保存 UPDATE が無音で失敗する（route 側は warn のみ・menu_id 単一フォールバック）。
--
-- 修正（発症前の真の予防）:
--   migration 上にも列を明示し、本番と repo を一致させる。本番には既存のため IF NOT EXISTS で無破壊。
--
-- 型根拠: bookings.menu_id は UUID REFERENCES facility_menus(id)（20260323000003_phase4_bookings.sql:30）
--   のため、その配列版である menu_ids は UUID[] とする。
--
-- 冪等性: ADD COLUMN IF NOT EXISTS。再適用しても安全（本番の既存列にも影響しない）。

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS menu_ids UUID[];

COMMENT ON COLUMN bookings.menu_ids IS '複数メニュー予約時の全メニューID配列（単一時は menu_id を使用）。';

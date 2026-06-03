-- service_packages.menu_id の FK 参照先を facility_menus に是正（round4 監査 #C）
--
-- 背景: 20260417_service_packages.sql は menu_id を「存在しないテーブル menus(id)」へ参照していた。
--   本プロジェクトのメニュー実テーブルは facility_menus のみ（menus は DDL 内に一切定義されない）。
--   クリーン環境では当該 CREATE TABLE が "relation menus does not exist" で失敗し得る。
--   既存環境で何らかの理由で適用済みの場合に備え、参照先を facility_menus へ張り替える。
--
-- 冪等・安全: service_packages が存在する場合のみ実行。誤った/旧 FK を落としてから正しい FK を貼り直す。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'service_packages') THEN
    -- menu_id 列に張られている既存 FK 制約を全て除去（参照先が誤っている可能性があるため）
    EXECUTE (
      SELECT COALESCE(string_agg(
        format('ALTER TABLE public.service_packages DROP CONSTRAINT %I;', tc.constraint_name), ' '), '')
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'service_packages'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'menu_id'
    );
    -- 正しい参照先（facility_menus）で FK を貼り直す
    ALTER TABLE public.service_packages
      ADD CONSTRAINT service_packages_menu_id_fkey
      FOREIGN KEY (menu_id) REFERENCES public.facility_menus(id) ON DELETE SET NULL;
  END IF;
END $$;

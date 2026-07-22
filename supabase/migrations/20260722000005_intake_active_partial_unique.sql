-- 【監査L2・恒久根治のDDL部】問診テンプレの UNIQUE(facility_id, is_active) を
-- 「アクティブ1件」の部分ユニークに直す。
-- 現状の複合 UNIQUE(facility_id, is_active)（20260417000019・インライン無名制約）は「非アクティブも
-- 施設あたり1件まで」になる意図しない制約。テンプレ管理UI未実装のため即時発症はしないが設計欠陥。
-- 複合 UNIQUE を撤去し is_active=TRUE の部分ユニークインデックスに置換して、本来意図の
-- 「アクティブは施設あたり1件・非アクティブは無制限」にする。
-- 制約名は環境依存のため、(facility_id, is_active) を対象にした UNIQUE 制約を introspection で特定して DROP する。

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  WHERE c.conrelid = 'intake_form_templates'::regclass
    AND c.contype = 'u'
    AND c.conkey = ARRAY[
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'intake_form_templates'::regclass AND attname = 'facility_id'),
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'intake_form_templates'::regclass AND attname = 'is_active')
    ]::smallint[]
  LIMIT 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE intake_form_templates DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_intake_active_per_facility
  ON intake_form_templates (facility_id) WHERE is_active;

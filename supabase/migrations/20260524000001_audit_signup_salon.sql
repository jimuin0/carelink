-- 登録ログを audit_logs に統合
-- (1) auth.users INSERT 時に audit_logs へ signup レコードを記録
-- (2) salons テーブル INSERT 時に audit_logs へ施設登録レコードを記録
--
-- これにより /admin の audit_logs 閲覧 UI から「いつ誰が客/店として登録したか」を一覧できる

-- --- (1) 客サインアップ監査ログ ---
CREATE OR REPLACE FUNCTION audit_log_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    NEW.id,
    'create',
    'auth.users',
    NEW.id::text,
    jsonb_build_object(
      'email', NEW.email,
      'provider', COALESCE(NEW.raw_app_meta_data->>'provider', 'email'),
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- 監査ログ失敗で signup を止めない
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_audit ON auth.users;
CREATE TRIGGER on_auth_user_created_audit
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION audit_log_new_user();

-- --- (2) 施設登録監査ログ ---
CREATE OR REPLACE FUNCTION audit_log_new_salon()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (action, table_name, record_id, new_values)
  VALUES (
    'create',
    'salons',
    NEW.id::text,
    jsonb_build_object(
      'facility_name', NEW.facility_name,
      'business_type', NEW.business_type,
      'representative_name', NEW.representative_name,
      'email', NEW.email,
      'phone', NEW.phone,
      'address', NEW.address
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_salon_created_audit ON salons;
CREATE TRIGGER on_salon_created_audit
AFTER INSERT ON salons
FOR EACH ROW EXECUTE FUNCTION audit_log_new_salon();

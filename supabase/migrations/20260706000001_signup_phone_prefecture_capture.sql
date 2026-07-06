-- 2026年7月6日: アカウント登録時点で電話番号・都道府県も profiles へ保存できるようにする。
-- signup フォームは auth.users.raw_user_meta_data に phone/prefecture を含めて送るよう変更済み
-- (アプリコード側)。handle_new_user トリガーがそれらを profiles にコピーするよう拡張する。
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, email, phone, prefecture)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'prefecture'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

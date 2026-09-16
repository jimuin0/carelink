-- 新規ユーザー作成時のプロフィールを、password/OAuth の両経路で同じ規則に統合する。
-- 既存 profiles は変更しない。auth.users INSERT 時の trigger だけに適用する前進migration。
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION
      'このデータベースは CareLink ではありません。接続先プロジェクトを確認してください。';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name, email, avatar_url, phone, prefecture)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'display_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      ''
    ),
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'avatar_url', ''),
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'prefecture'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

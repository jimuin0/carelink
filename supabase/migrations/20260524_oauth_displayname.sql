-- Google OAuth で signup したユーザーの display_name が空になる問題を修正
-- Google は raw_user_meta_data に name / full_name を入れるが、display_name は入れない
-- 既存トリガは display_name しか見ていなかったため、profile.display_name = '' で作成され
-- 画面では「ユーザー」フォールバック → アバター頭文字「ユ」として表示されていた

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, email, avatar_url)
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
    NULLIF(NEW.raw_user_meta_data->>'avatar_url', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 既存ユーザーのバックフィル（display_name が空の profile を auth.users から補完）
UPDATE profiles p
SET display_name = COALESCE(
      NULLIF(u.raw_user_meta_data->>'display_name', ''),
      NULLIF(u.raw_user_meta_data->>'full_name', ''),
      NULLIF(u.raw_user_meta_data->>'name', ''),
      NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
      ''
    ),
    avatar_url = COALESCE(p.avatar_url, NULLIF(u.raw_user_meta_data->>'avatar_url', '')),
    updated_at = NOW()
FROM auth.users u
WHERE p.id = u.id
  AND (p.display_name IS NULL OR p.display_name = '');

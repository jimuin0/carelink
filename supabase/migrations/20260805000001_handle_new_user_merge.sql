-- ============================================================================
-- handle_new_user: 本番とリポジトリで両方向に分岐していたものを統合する（2026年8月5日）
-- ============================================================================
-- 🔴 どうやって見つけたか:
--   スキーマ・フィンガープリント監視の本番初稼働で body_md5 の食い違いを実測。
--   旧監視は関数を名前でしか見ておらず、本体の違いは構造的に検知不能だった。
--
-- 実測した分岐（どちらか一方を選ぶと必ず機能が失われる）:
--   リポジトリのみ … phone / prefecture の取込（20260706000001 で追加。本番へ未適用）
--   本番のみ       … avatar_url / display_name の 4 段フォールバック（OAuth 対応）/
--                    ON CONFLICT DO NOTHING / EXCEPTION ハンドラ
--
-- 🔴 それぞれが無いと何が起きるか:
--   ON CONFLICT が無い     … profiles に行が既在すると一意制約違反でトリガが落ち、
--                            **サインアップ全体が失敗する**
--   EXCEPTION が無い       … profiles 側の些細な失敗が全部サインアップ失敗に化ける
--   4 段フォールバックが無い … OAuth 経由（メタデータが full_name / name）の利用者の
--                            display_name が空になる
--   phone/prefecture が無い … 登録フォームで入力させた値が profiles に入らない
--
-- 本 migration は上記を全部持つ統合版にする。profiles には avatar_url / phone /
-- prefecture の 3 列とも実在することを確認済み。
--
-- ⚠️ 本番へは未適用。適用は認証経路に触れるため神原さんの明示承認後に行う。
--   適用するまで本番は phone/prefecture を取り込まない状態が続く。

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
  INSERT INTO profiles (id, display_name, email, avatar_url, phone, prefecture)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'display_name',''),
      NULLIF(NEW.raw_user_meta_data->>'full_name',''),
      NULLIF(NEW.raw_user_meta_data->>'name',''),
      NULLIF(split_part(COALESCE(NEW.email,''),'@',1),''),
      ''
    ),
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'avatar_url',''),
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'prefecture'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- プロフィール作成失敗でもサインアップを止めない
END;
$function$;

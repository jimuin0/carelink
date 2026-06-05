-- サロン編集の単一画像ウィジェット保存用（NULL許容・IF NOT EXISTS・既存無影響）。
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS header_photo_url TEXT,  -- サロンヘッダー写真
  ADD COLUMN IF NOT EXISTS logo_url         TEXT,  -- お店ロゴ
  ADD COLUMN IF NOT EXISTS owner_photo_url  TEXT;  -- サロンからの一言：メッセージ写真

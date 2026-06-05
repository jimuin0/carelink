-- サロン掲載情報編集の残り項目を保存可能にする（HPB準拠・全て NULL 許容・既存無影響）。
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS business_hours_text TEXT,  -- 営業時間（フリーテキスト表示用。構造化 business_hours とは別）
  ADD COLUMN IF NOT EXISTS directions          TEXT,  -- 道案内・アクセス
  ADD COLUMN IF NOT EXISTS remarks             TEXT,  -- 備考
  ADD COLUMN IF NOT EXISTS owner_name          TEXT,  -- サロンからの一言：氏名
  ADD COLUMN IF NOT EXISTS owner_title         TEXT,  -- サロンからの一言：肩書き
  ADD COLUMN IF NOT EXISTS owner_message       TEXT,  -- サロンからの一言：メッセージ
  ADD COLUMN IF NOT EXISTS genres              TEXT[]; -- ジャンル（最大6）

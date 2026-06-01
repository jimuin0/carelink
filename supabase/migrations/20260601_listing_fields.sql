-- 掲載管理の残り項目を保存可能にする（全て NULL/デフォルト許容・IF NOT EXISTS・既存無影響）。

-- メニュー：予約可否・掲載/非掲載・価格表示オプション
ALTER TABLE facility_menus
  ADD COLUMN IF NOT EXISTS reservable       BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_published     BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS price_show_tilde BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_ask        BOOLEAN DEFAULT false;

-- 写真：タイトル・ジャンル・検索用カテゴリ・画像応募・掲載/非掲載
ALTER TABLE facility_photos
  ADD COLUMN IF NOT EXISTS title            TEXT,
  ADD COLUMN IF NOT EXISTS genre            TEXT,
  ADD COLUMN IF NOT EXISTS search_category  TEXT,
  ADD COLUMN IF NOT EXISTS image_submission BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_published     BOOLEAN DEFAULT true;

-- サロン：設備明細・スタッフ数明細
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS equipment       JSONB,
  ADD COLUMN IF NOT EXISTS staff_breakdown JSONB;

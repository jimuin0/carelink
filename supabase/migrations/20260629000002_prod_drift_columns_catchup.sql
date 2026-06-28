-- 本番先行列の catch-up（fresh-apply==本番 を列レベルで成立させる）。
--
-- 背景（事実・2026年6月29日 確定）:
--   本番（ref: xzafxiupbflvgbarrihe）には存在するが supabase/migrations/ に定義が無い列が
--   52 列存在し、`supabase start`（fresh-apply＝CI/E2E のローカル DB）が本番スキーマを
--   再現できていなかった（out-of-band な Dashboard 手動 ALTER の catch-up 漏れ。
--   2026-06-02 の「42 テーブル丸ごと欠落」事故の「列レベル版」）。
--   各列の正確な型・NULL 可否・デフォルト・FK は本番 information_schema / pg_constraint の
--   introspection で実取得し、本 migration で忠実に再現する（推測なし）。
--
-- 方針:
--   - 全 DDL は ADD COLUMN IF NOT EXISTS で冪等（本番への再適用は列存在によりスキップ＝副作用ゼロ。
--     本番には既に当該列が在るため、本 migration の主目的はあくまで fresh-apply の本番一致）。
--   - 型は本番に合わせ、database.types.ts / schema-snapshot.json は無変更（本番一致のため）。
--   - FK は本番 pg_constraint の定義（ON DELETE 挙動含む）を忠実に再現する。
--     ただし blog_posts.author_name_id → blog_authors(id) の FK は付与しない:
--       blog_authors は migration を持たない本番残存テーブル（tests/contract の KNOWN_PROD_ONLY）で
--       fresh DB に存在せず、FK を付けると fresh-apply が「参照先テーブル不在」で失敗するため、
--       列のみ追加する（列レベルの本番一致は成立。FK 差分は blog_authors の migration-less 問題に帰属）。
--
-- このドリフトの再発は tests/contract/migration-prod-drift.contract.test.ts の
--   逆方向テスト（types 列 ⊆ migration 列）が発症前（マージ前）に検知する。

-- blog_posts
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS author_name_id UUID,                                          -- 本番FK: blog_authors(id) ON DELETE SET NULL（上記理由でFK省略・列のみ）
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- coupons
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS image_submission BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS presentation_timing TEXT,
  ADD COLUMN IF NOT EXISTS search_category1 TEXT,
  ADD COLUMN IF NOT EXISTS search_category2 TEXT,
  ADD COLUMN IF NOT EXISTS usage_condition TEXT;

-- facility_menus
ALTER TABLE facility_menus
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS price_ask BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS price_show_tilde BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reservable BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS search_category TEXT,
  ADD COLUMN IF NOT EXISTS subcategory TEXT;

-- facility_photos
ALTER TABLE facility_photos
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS genre TEXT,
  ADD COLUMN IF NOT EXISTS image_submission BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS search_category TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT;

-- facility_profiles
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS business_hours_text TEXT,
  ADD COLUMN IF NOT EXISTS design_color TEXT,
  ADD COLUMN IF NOT EXISTS design_template TEXT,
  ADD COLUMN IF NOT EXISTS directions TEXT,
  ADD COLUMN IF NOT EXISTS equipment JSONB,
  ADD COLUMN IF NOT EXISTS genres TEXT[],
  ADD COLUMN IF NOT EXISTS header_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS menu_remarks TEXT,
  ADD COLUMN IF NOT EXISTS owner_message TEXT,
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS owner_title TEXT,
  ADD COLUMN IF NOT EXISTS parking_text TEXT,
  ADD COLUMN IF NOT EXISTS payment_other TEXT,
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS staff_breakdown JSONB;

-- facility_reviews
ALTER TABLE facility_reviews
  ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_pickup BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reply TEXT,
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visit_date DATE;

-- review_helpful
--   本番では migration 定義（複合 PK (review_id, user_id)）に加えて id UUID が
--   out-of-band 追加されている。列レベルの本番一致のため id を追加する（既存 PK は変更しない＝
--   PK/UNIQUE の構成は列ドリフト検知の対象外であり、本タスクの列 catch-up スコープ外）。
ALTER TABLE review_helpful
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

-- staff_profiles
ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS nomination_fee INTEGER DEFAULT 0;

-- webhook_retry_queue
ALTER TABLE webhook_retry_queue
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

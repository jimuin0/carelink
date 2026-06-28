-- 2026-06-29: 本番に out-of-band で存在するが migration が定義していなかった 52 列を
--   migration へ catch-up し、fresh-apply（supabase start＝CI / E2E のローカル DB）が本番を
--   忠実に再現できるようにする（冪等・無破壊）。
--
-- 背景（事実・実データで確定）:
--   #296（bookings.source 等）と同根の systemic ドリフト。database.types.ts は本番
--   （ref: xzafxiupbflvgbarrihe）introspection 生成物で本番実態と一致しており【型は正】、
--   migration 側が追いついていなかった（2026-06-02 の catch-up apply 以前からの旧世代列）。
--   tests/contract/migration-prod-drift.contract.test.ts の逆方向検査（本番にあって
--   migration に無い列）で 52 列を検知・列挙していたものを、本 migration で解消する。
--
--   各列の型・NULL 可否・DEFAULT は本番 information_schema.columns を実測して一致させた
--   （神原さんが Supabase SQL Editor で取得した 52 行の DDL に基づく）。
--
-- 冪等性・無破壊:
--   - 全て ADD COLUMN IF NOT EXISTS。本番では列が既在のため再適用しても no-op。
--   - NOT NULL 列は本番と同一の DEFAULT を付与（fresh-apply で既存行があっても DEFAULT で
--     backfill されるため NOT NULL でも安全）。
--   - FK 制約は本 SQL の対象外（information_schema.columns では FK の有無を確定できず、
--     推測で REFERENCES を付けない方針＝事実のみ。列ドリフトの解消が目的で、本番でも
--     これらは uuid 列として存在する）。constraint レベルの整合は別途。

-- blog_posts
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS author_name_id UUID;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS coupon_id UUID;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- coupons
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS image_submission BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS presentation_timing TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS search_category1 TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS search_category2 TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS usage_condition TEXT;

-- facility_menus
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS price_ask BOOLEAN DEFAULT false;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS price_show_tilde BOOLEAN DEFAULT false;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS reservable BOOLEAN DEFAULT true;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS search_category TEXT;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS subcategory TEXT;

-- facility_photos
ALTER TABLE facility_photos ADD COLUMN IF NOT EXISTS coupon_id UUID;
ALTER TABLE facility_photos ADD COLUMN IF NOT EXISTS genre TEXT;
ALTER TABLE facility_photos ADD COLUMN IF NOT EXISTS image_submission BOOLEAN DEFAULT false;
ALTER TABLE facility_photos ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true;
ALTER TABLE facility_photos ADD COLUMN IF NOT EXISTS search_category TEXT;
ALTER TABLE facility_photos ADD COLUMN IF NOT EXISTS title TEXT;

-- facility_profiles
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS business_hours_text TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS design_color TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS design_template TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS directions TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS equipment JSONB;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS genres TEXT[];
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS header_photo_url TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS menu_remarks TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS owner_message TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS owner_photo_url TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS owner_title TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS parking_text TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS payment_other TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS staff_breakdown JSONB;

-- facility_reviews
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS booking_id UUID;
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS is_pickup BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS reply TEXT;
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS staff_id UUID;
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS visit_date DATE;

-- review_helpful（本番は複合PK (review_id, user_id) に加えて id 列が存在＝本番一致で列追加。
--   PK 構成は本番のまま変更しない＝列レベルのみ catch-up）
ALTER TABLE review_helpful ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

-- staff_profiles
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS nomination_fee INTEGER DEFAULT 0;

-- webhook_retry_queue
ALTER TABLE webhook_retry_queue ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE webhook_retry_queue ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- =============================================================================
-- ストック写真の棚卸し（本番の実データを一覧化する）
--
-- 【使い方】Supabase Dashboard → SQL Editor に貼って実行する。
--   project ref は必ず xzafxiupbflvgbarrihe（CareLink 本番）であることを確認すること。
--   https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe/sql
--   SQL Editor は postgres 権限で走るので RLS を素通しし、真の全件が見える。
--
-- 【なぜ SQL 直打ちなのか】この環境（Claude 実行環境）には本番の接続情報が無いため、
--   スクリプトを書いても動作を一度も検証できない。未検証のコードを本番へ向けるより、
--   その場で結果が見えて副作用が無い SELECT を渡すほうが安全で速い。
--
-- 【安全性】本ファイルは SELECT のみ。1行も書き換えない。
--
-- 【列の実在チェック】下の `-- @check <table>.<column>` 行は
--   src/__tests__/diagnostic-sql-columns.test.ts が schema-snapshot.json と突合する。
--   存在しない列を書いたら CI が落ちる（「存在しない列を参照して無音停止」の再発防止）。
--
-- @check blog_posts.image_urls
-- @check blog_posts.thumbnail_url
-- @check coupons.image_url
-- @check facility_menus.photo_url
-- @check facility_photos.photo_url
-- @check facility_profiles.header_photo_url
-- @check facility_profiles.logo_url
-- @check facility_profiles.main_photo_url
-- @check facility_profiles.owner_photo_url
-- @check facility_reviews.photo_urls
-- @check feature_articles.image_url
-- @check features.banner_image_url
-- @check gbp_posts.photo_url
-- @check job_seekers.photo_url
-- @check platform_blog_posts.thumbnail_url
-- @check profiles.avatar_url
-- @check public_reviews.photo_urls
-- @check salons.photo_url
-- @check salons.photo_urls
-- @check staff_photos.photo_url
-- @check staff_profiles.photo_url
-- @check treatment_catalogs.after_photo_url
-- @check treatment_catalogs.before_photo_url
-- @check white_label_domains.logo_url
-- =============================================================================

-- src/lib/stock-image-guard.ts の STOCK_IMAGE_DOMAINS と同じ集合。
-- 片方だけ増やすと判定がズレるので、増やすときは必ず両方に足すこと。
WITH pattern AS (
  SELECT '://([a-z0-9-]+\.)*(unsplash\.com|pexels\.com|pixabay\.com|istockphoto\.com|shutterstock\.com|gettyimages\.com|freepik\.com|photo-ac\.com|stock\.adobe\.com)(/|$)'::text AS re
),
hits AS (
  -- ── 単一URL列 ──────────────────────────────────────────────────────────
  SELECT 'blog_posts' t, 'thumbnail_url' c, id::text pk, thumbnail_url url FROM blog_posts, pattern WHERE thumbnail_url ~* pattern.re
  UNION ALL SELECT 'coupons', 'image_url', id::text, image_url FROM coupons, pattern WHERE image_url ~* pattern.re
  UNION ALL SELECT 'facility_menus', 'photo_url', id::text, photo_url FROM facility_menus, pattern WHERE photo_url ~* pattern.re
  UNION ALL SELECT 'facility_photos', 'photo_url', id::text, photo_url FROM facility_photos, pattern WHERE photo_url ~* pattern.re
  UNION ALL SELECT 'facility_profiles', 'main_photo_url', id::text, main_photo_url FROM facility_profiles, pattern WHERE main_photo_url ~* pattern.re
  UNION ALL SELECT 'facility_profiles', 'header_photo_url', id::text, header_photo_url FROM facility_profiles, pattern WHERE header_photo_url ~* pattern.re
  UNION ALL SELECT 'facility_profiles', 'logo_url', id::text, logo_url FROM facility_profiles, pattern WHERE logo_url ~* pattern.re
  UNION ALL SELECT 'facility_profiles', 'owner_photo_url', id::text, owner_photo_url FROM facility_profiles, pattern WHERE owner_photo_url ~* pattern.re
  UNION ALL SELECT 'feature_articles', 'image_url', id::text, image_url FROM feature_articles, pattern WHERE image_url ~* pattern.re
  UNION ALL SELECT 'features', 'banner_image_url', id::text, banner_image_url FROM features, pattern WHERE banner_image_url ~* pattern.re
  UNION ALL SELECT 'gbp_posts', 'photo_url', id::text, photo_url FROM gbp_posts, pattern WHERE photo_url ~* pattern.re
  UNION ALL SELECT 'job_seekers', 'photo_url', id::text, photo_url FROM job_seekers, pattern WHERE photo_url ~* pattern.re
  UNION ALL SELECT 'platform_blog_posts', 'thumbnail_url', id::text, thumbnail_url FROM platform_blog_posts, pattern WHERE thumbnail_url ~* pattern.re
  UNION ALL SELECT 'profiles', 'avatar_url', id::text, avatar_url FROM profiles, pattern WHERE avatar_url ~* pattern.re
  UNION ALL SELECT 'salons', 'photo_url', id::text, photo_url FROM salons, pattern WHERE photo_url ~* pattern.re
  UNION ALL SELECT 'staff_photos', 'photo_url', id::text, photo_url FROM staff_photos, pattern WHERE photo_url ~* pattern.re
  UNION ALL SELECT 'staff_profiles', 'photo_url', id::text, photo_url FROM staff_profiles, pattern WHERE photo_url ~* pattern.re
  UNION ALL SELECT 'treatment_catalogs', 'before_photo_url', id::text, before_photo_url FROM treatment_catalogs, pattern WHERE before_photo_url ~* pattern.re
  UNION ALL SELECT 'treatment_catalogs', 'after_photo_url', id::text, after_photo_url FROM treatment_catalogs, pattern WHERE after_photo_url ~* pattern.re
  UNION ALL SELECT 'white_label_domains', 'logo_url', id::text, logo_url FROM white_label_domains, pattern WHERE logo_url ~* pattern.re

  -- ── 配列URL列（unnest して1要素ずつ突合する。配列全体の ~* は要素を見ないため）──
  UNION ALL SELECT 'blog_posts', 'image_urls', b.id::text, u
    FROM blog_posts b, unnest(b.image_urls) AS u, pattern WHERE u ~* pattern.re
  UNION ALL SELECT 'facility_reviews', 'photo_urls', r.id::text, u
    FROM facility_reviews r, unnest(r.photo_urls) AS u, pattern WHERE u ~* pattern.re
  UNION ALL SELECT 'public_reviews', 'photo_urls', p.id::text, u
    FROM public_reviews p, unnest(p.photo_urls) AS u, pattern WHERE u ~* pattern.re
  UNION ALL SELECT 'salons', 'photo_urls', s.id::text, u
    FROM salons s, unnest(s.photo_urls) AS u, pattern WHERE u ~* pattern.re
)

-- ① まず件数だけ見る（どこに何件残っているか）
SELECT t AS table_name, c AS column_name, count(*) AS rows
FROM hits GROUP BY t, c ORDER BY count(*) DESC, t, c;

-- ② 実物を見るときは上を消して以下を実行する
-- SELECT t AS table_name, c AS column_name, pk AS id, url FROM hits ORDER BY t, c, pk;

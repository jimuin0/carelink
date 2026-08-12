-- =============================================================================
-- 部分更新バグで消えた画像の被害範囲を特定する（2026年8月11日）
--
-- 【背景】PATCH が `.update({ ...parsed.data, X: parsed.data.X || null })` と書かれており、
--   X を含まないリクエストでも常に null が書き込まれていた。管理画面の以下の操作が該当する:
--     ・/admin/menus の並び替え(↑↓)  … `{ sort_order }` だけ送る → facility_menus.photo_url が消える
--     ・/admin/features の公開トグル … `{ is_active }` だけ送る → feature_articles.image_url が消える
--     ・/admin/settings の保存 …… website_url。管理画面は常に送っていたため未発症
--   コード側は修正済みだが、【既に消えた値はコードでは戻らない】ため被害範囲を測る。
--
-- 【使い方】Supabase Dashboard → SQL Editor に貼って実行する。
--   project ref は必ず xzafxiupbflvgbarrihe（CareLink 本番）であることを確認すること。
--   https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe/sql
--
-- 【安全性】本ファイルは SELECT のみ。1行も書き換えない。
--
-- @check facility_menus.photo_url
-- @check feature_articles.image_url
-- @check facility_profiles.website_url
-- @check audit_logs.table_name
-- @check audit_logs.action
-- @check audit_logs.new_values
-- @check audit_logs.record_id
-- @check audit_logs.created_at
-- =============================================================================

-- ① 画像が入っていない行がどれだけあるか（母数つき。比率で見ないと多寡が判断できない）
SELECT 'facility_menus.photo_url' AS target,
       count(*) FILTER (WHERE photo_url IS NULL OR photo_url = '') AS empty_rows,
       count(*) AS total_rows
FROM facility_menus
UNION ALL
SELECT 'feature_articles.image_url',
       count(*) FILTER (WHERE image_url IS NULL OR image_url = ''),
       count(*)
FROM feature_articles
UNION ALL
SELECT 'facility_profiles.website_url',
       count(*) FILTER (WHERE website_url IS NULL OR website_url = ''),
       count(*)
FROM facility_profiles;

-- ② ①の「空」が本当にこのバグ由来かを監査ログで特定する。
--    両ルートの PATCH は writeAuditLog に newValues として parsed.data をそのまま渡している。
--    つまり【送られたキーの集合が new_values に残っている】ので、
--    「画像キーを含まない更新」＝バグを踏んだ操作を後から名指しできる。
--    ⚠ audit_logs は fire-and-forget（失敗しても本体を止めない）。ここに出る行は
--      「確実に踏んだ」証拠になるが、出ない行が「踏んでいない」証明にはならない。
SELECT
  a.created_at,
  a.table_name,
  a.record_id,
  a.user_id,
  a.new_values
FROM audit_logs a
WHERE a.action = 'update'
  AND (
        (a.table_name = 'facility_menus'
           AND a.new_values ? 'sort_order' AND NOT (a.new_values ? 'photo_url'))
     OR (a.table_name = 'feature_articles'
           AND a.new_values ? 'is_active'  AND NOT (a.new_values ? 'image_url'))
      )
ORDER BY a.created_at DESC
LIMIT 200;

-- ③ ②で挙がったレコードのうち、今まさに画像が空のもの（＝復旧対象の確定リスト）
--
-- 🔴 `a.record_id` は【TEXT】、各表の `id` は【UUID】。素で `=` すると
--    ERROR: 42883 operator does not exist: text = uuid で落ちる（本番で実際に踏んだ）。
--    audit_logs.record_id はどの表の id でも入る汎用列なので TEXT になっている。必ず ::text で揃える。
SELECT 'facility_menus' AS table_name, m.id::text AS id, m.name AS label, m.facility_id::text AS facility_id
FROM facility_menus m
WHERE (m.photo_url IS NULL OR m.photo_url = '')
  AND EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.table_name = 'facility_menus' AND a.action = 'update'
      AND a.record_id = m.id::text
      AND a.new_values ? 'sort_order' AND NOT (a.new_values ? 'photo_url')
  )
UNION ALL
SELECT 'feature_articles', f.id::text, f.title, NULL::text
FROM feature_articles f
WHERE (f.image_url IS NULL OR f.image_url = '')
  AND EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.table_name = 'feature_articles' AND a.action = 'update'
      AND a.record_id = f.id::text
      AND a.new_values ? 'is_active' AND NOT (a.new_values ? 'image_url')
  );

-- =============================================================================
-- 【復旧について】audit_logs は old_values を持つが、上記2ルートの PATCH は old_values を
-- 記録していない（newValues のみ渡している）ため、【消えた URL 自体はログから復元できない】。
-- 復旧は「元画像を再アップロードして貼り直す」しかない。③のリストが作業対象になる。
-- =============================================================================

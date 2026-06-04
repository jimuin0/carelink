-- 1ユーザー=1施設(owner) の不変条件を DB で保証（受け入れ体制・setup の TOCTOU 根本対策）
--
-- 事実: facility_members への insert は src/app/api/facility/setup ただ1箇所で、owner を1件作る運用。
--   setup は「既存メンバーがいれば既存施設を返す」が、並行 setup（二重タブ/リロード）では
--   check-then-insert の間にロックが無く、user_id 単独のユニーク制約も無いため、同一ユーザーに
--   facility_members が2行・facility_profiles が2件できる。すると middleware/settings/setup が
--   user_id で .single()/.maybeSingle() するため 2行で破綻し、当該オーナーが管理画面に入れなくなる。
--
-- 対策: role='owner' の部分ユニーク索引で「1ユーザーが owner になれる施設は1つ」を保証する。
--   並行 setup の2件目の owner insert は UNIQUE 違反(23505)で失敗し、アプリ側はその施設を破棄して
--   既存施設を返す（重複作成・締め出しを防ぐ）。staff 等の複数所属は将来も許容する（owner 限定のため）。
--
-- 冪等: IF NOT EXISTS。既存データは setup の「既存なら返す」運用で重複が無い前提（あれば作成時にエラーで
--   検知できる）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_members_owner_unique
  ON facility_members (user_id)
  WHERE role = 'owner';

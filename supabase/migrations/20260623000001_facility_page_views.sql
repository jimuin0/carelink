-- 施設ページ閲覧の時系列記録（期間窓ファネル用）。
-- facility_profiles.view_count は累積カウンタのため期間集計に使えない。タイムスタンプ付き行を
-- 持つことで、admin/funnel の最上段「ページ閲覧」を当月/先月などの期間窓で集計できるようにする。
CREATE TABLE IF NOT EXISTS facility_page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fpv_facility_created ON facility_page_views(facility_id, created_at DESC);

-- 直アクセスは全拒否（ポリシーを作らない）。書き込みは下記 SECURITY DEFINER RPC 経由、
-- 読み取りは service role（RLS バイパス）経由のみ。anon 直書き込みポリシーは作らない。
ALTER TABLE facility_page_views ENABLE ROW LEVEL SECURITY;

-- ページ閲覧記録 RPC：時系列行を1件挿入しつつ累積 view_count を加算する（匿名クライアントから呼ぶ）。
-- SECURITY DEFINER + search_path 固定（L6: secdef-search-path-lint 準拠）。
CREATE OR REPLACE FUNCTION record_facility_page_view(facility_uuid UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO facility_page_views (facility_id) VALUES (facility_uuid);
  UPDATE facility_profiles SET view_count = view_count + 1 WHERE id = facility_uuid;
$$;

GRANT EXECUTE ON FUNCTION record_facility_page_view(UUID) TO anon, authenticated;

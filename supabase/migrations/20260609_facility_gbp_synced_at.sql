-- sync-google-ratings の rotation 用列。
--
-- 旧実装は ORDER BY 無し `.limit(200)` ＋ ループ内 `sleep(1100)`（Places API 1 QPM）で、
-- 200 件 × 1.1s = 220s が関数 maxDuration を超えてタイムアウトし、かつ毎回非決定的な
-- 先頭集合だけ同期され、GBP 連携施設が一定数を超えると一部が永久に未同期だった。
--
-- gbp_synced_at（最終同期試行時刻）を追加し、最も古い順（NULLS FIRST = 未同期優先）に
-- 実時間予算内で回す rotation により、全施設が週次で順繰りに同期される。
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS gbp_synced_at TIMESTAMPTZ;

-- rotation クエリ（status='published' AND gbp_place_id NOT NULL を gbp_synced_at 昇順 NULLS FIRST）用の部分 index。
CREATE INDEX IF NOT EXISTS idx_facility_gbp_sync
  ON facility_profiles (gbp_synced_at NULLS FIRST)
  WHERE gbp_place_id IS NOT NULL AND status = 'published';

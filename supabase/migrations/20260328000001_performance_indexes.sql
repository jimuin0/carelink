-- パフォーマンス最適化インデックス (2026-03-28)

-- 検索ソート用（published限定の部分インデックス）
CREATE INDEX IF NOT EXISTS idx_fp_published_created
  ON facility_profiles(created_at DESC) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_fp_published_rating
  ON facility_profiles(rating_avg DESC NULLS LAST) WHERE status = 'published';

-- 予約競合チェック用（アクティブ予約のみ）
-- 🔴 2026-08-11 修正: cancel_fee_paid（キャンセル料のみ確定・施術としては使用されない
--   終端ステータス。src/lib/booking-status.ts・migration 20260621000004 で導入）を除外に
--   追加した。本番は既にこの新しい述語でインデックスを保持しており（本番が新しい）、この
--   migration の定義だけが古いまま取り残されていたため、定義そのものを書き換えて収斂させる
--   （新しい重複インデックスを作るのではなく、この CREATE INDEX 文自体が単一の定義元）。
--   cancel_fee_paid を除外しないと、解放済みのはずの staff/date/time 枠が予約競合チェックに
--   誤って引っかかる。非 UNIQUE インデックス（検索高速化のみ）のため、書き換えても
--   INSERT/UPDATE を拒否する経路は無い（クエリプランへの影響のみ）。
CREATE INDEX IF NOT EXISTS idx_bookings_staff_date_active
  ON bookings(staff_id, booking_date, start_time, end_time)
  WHERE status NOT IN ('cancelled', 'no_show', 'cancel_fee_paid');

-- 口コミ取得用（施設別・公開済み）
CREATE INDEX IF NOT EXISTS idx_reviews_facility_published
  ON facility_reviews(facility_id, created_at DESC) WHERE status = 'published';

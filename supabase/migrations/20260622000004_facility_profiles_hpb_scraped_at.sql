-- facility_profiles に HPB メニュースクレイプの「最終処理時刻」カラムを追加。
-- /api/cron/hpb-menu-scrape は旧実装が .order('id') + .limit(200) だったため、
-- HPB 連携施設(hpb_sln_id 設定済み)が一定数を超えると id 後方が毎 run スクレイプ
-- 対象外になり、メニューが恒久未更新(silent miss)になっていた。
-- sync-google-ratings(gbp_synced_at)と対称に、hpb_scraped_at 昇順(未処理=NULLS FIRST)
-- で古い順ローテに切り替え、処理ごとに当該列を更新して全施設を順繰りにスクレイプする。
-- NULL(未スクレイプ)の既存施設が最優先で拾われ、初回 run 群で全件が一巡する。
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS hpb_scraped_at TIMESTAMPTZ;

-- facility_profiles に最寄り駅カラムを追加。
-- 駅サジェスト(/api/facilities/suggest, /api/stations)・比較ページ・施設ページの
-- アクセス情報(AccessInfo)・検索サジェスト(SearchSuggest)は既に nearest_station を
-- 参照しているが、facility_profiles に列が無く読み取りが 400 になっていた。
-- 公開施設プロフィール側で駅情報を保持・編集（/admin/settings）できるようにする。
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS nearest_station TEXT;

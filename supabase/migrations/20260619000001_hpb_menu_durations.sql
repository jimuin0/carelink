-- HPB(ホットペッパービューティー)メニュー自動取得: 生取得値テーブル + 施設のHPB店舗ID紐付け。
--
-- soel の hpb_menu_durations を CareLink(マルチ施設)向けに facility_id 付きで移植。
-- 客が実際に見る HPB 予約ページから取得した name/duration/price 等を貯める正典テーブル。
-- 取得値は再取得で上書きするが、管理画面での人手の手直しは *_override 列に保持し、
-- 再取得で消さない(上書き保護)。実メニュー(facility_menus)への反映は後続PRで行う。

-- 施設→HPB店舗ID(slnID 例: H000537368)の紐付け。1アカウント1施設(サロンボード型)。
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS hpb_sln_id TEXT;

CREATE TABLE IF NOT EXISTS hpb_menu_durations (
  facility_id            UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  -- couponId(CP…) または menuId(MN…)。HPB 全体でユニーク。
  ref_id                 TEXT NOT NULL,
  kind                   TEXT NOT NULL DEFAULT 'coupon' CHECK (kind IN ('coupon', 'menu')),
  store_id               TEXT NOT NULL,
  -- HPB から取得した素の値(再取得で上書きされる)。
  name                   TEXT NOT NULL,
  target                 TEXT,
  duration_min           INT,
  price                  INT,
  description            TEXT,
  -- 上書き保護(管理画面での人手の手直し。再取得で消さない)。NULL = 未手直し。
  name_override          TEXT,
  duration_min_override  INT,
  price_override         INT,
  description_override   TEXT,
  -- 管理画面で「使わない」とチェックされたメニューを隠す(facility_menus へ反映しない)。
  is_hidden              BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (facility_id, ref_id)
);

ALTER TABLE hpb_menu_durations ENABLE ROW LEVEL SECURITY;

-- 施設メンバーのみ自施設の HPB メニューを操作できる(API は service_role 経由だが多層防御)。
CREATE POLICY "hpb_menu_durations_member_all" ON hpb_menu_durations
  FOR ALL USING (
    facility_id IN (
      SELECT facility_id FROM facility_members WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_hpb_menu_durations_facility
  ON hpb_menu_durations (facility_id, kind);

-- updated_at 自動更新トリガー。
CREATE OR REPLACE FUNCTION set_hpb_menu_durations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hpb_menu_durations_updated_at ON hpb_menu_durations;
CREATE TRIGGER trg_hpb_menu_durations_updated_at
  BEFORE UPDATE ON hpb_menu_durations
  FOR EACH ROW EXECUTE FUNCTION set_hpb_menu_durations_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON hpb_menu_durations TO authenticated;

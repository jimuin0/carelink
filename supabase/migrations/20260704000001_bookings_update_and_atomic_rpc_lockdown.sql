-- ============================================================================
-- 予約テーブルの改竄面を恒久封鎖（DB-1 / DB-2・2026年7月4日）
-- 読み取り専用 DB 監査で確定した2件を、発症前予防として根治する。
-- 既存 migration は無改変。本ファイルで現行の有効状態のみを是正する（drift 防止）。
--
-- 【共通根本原因】Supabase の既定 default privileges が public スキーマの全テーブル/関数に
-- anon / authenticated の各種権限を自動付与する。この機構は既に 20260605000001（関数 EXECUTE）
-- と 20260615000002（bookings INSERT）が実測付きで明記済み。そのため RLS ポリシーや関数側の
-- REVOKE ALL FROM PUBLIC だけでは塞ぎ切れず、PostgREST を直接叩くとサーバ API の認証・
-- サーバ側価格計算を迂回できてしまう。以下で anon / authenticated の直接権限を明示撤回する。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- DB-1: bookings への anon / authenticated 直接 UPDATE を撤去する
--
--   既定付与により anon / authenticated は bookings に UPDATE 権を持ち、permissive な
--     "bookings_owner_update"          USING (auth.uid() = user_id)   ← WITH CHECK 無し
--     "bookings_facility_member_update" USING (施設メンバー相関)       ← WITH CHECK 無し
--   経由で、PostgREST から自分（または自施設）の予約の total_price / status / facility_id /
--   staff_id を直接改竄できた。UPDATE の WITH CHECK 省略時は USING が新行にも適用されるが、
--   USING は user_id（や施設相関）しか縛らないため、それ以外の列（金額・状態・施設）は無制約。
--   ＝顧客が自分の予約を total_price=0 や status='confirmed' に書き換えられる状態だった。
--
--   アプリの予約更新は全て service_role（RLS バイパス）または change_booking_atomic 経由で、
--   anon / authenticated クライアントが bookings を直接 UPDATE する箇所は皆無（全 src 精査済み。
--   直接 .from('bookings').update(...) は 5 箇所とも service_role クライアント）。
--   よって直接 UPDATE 権を撤去し、宙に浮いた permissive ポリシー（将来 UPDATE grant が再付与
--   されると即座に穴が再開する地雷）も除去する。service_role は RLS を無視するため管理画面・
--   サーバ処理の予約更新には一切影響しない。SELECT ポリシー（自分の予約閲覧）は無改変。
-- ----------------------------------------------------------------------------
REVOKE UPDATE ON bookings FROM anon, authenticated;
DROP POLICY IF EXISTS "bookings_owner_update" ON bookings;
DROP POLICY IF EXISTS "bookings_facility_member_update" ON bookings;

-- ----------------------------------------------------------------------------
-- DB-2: create_booking_atomic / change_booking_atomic を service_role 限定にする
--
--   両関数は SECURITY DEFINER かつ anon / authenticated に EXECUTE 付与されており、PostgREST の
--   /rest/v1/rpc/... から直接呼べた。
--     - create_booking_atomic は p_user_id / p_total_price / p_status を一切検証せず全入力を
--       信頼するため、攻撃者がサーバ API（booking/route.ts の認証・サーバ側価格計算）を迂回して
--       total_price=0・任意 user_id・status='confirmed' の予約を捏造できた。
--     - change_booking_atomic は所有権を呼び出し側パラメータ p_user_id のみで判定するため、
--       booking_id と被害者の user_id を渡せば他人の予約を無断でリスケできる IDOR だった。
--
--   同一 PR で、サーバ API（booking/route.ts・change/route.ts）の RPC 呼び出しを service_role
--   クライアントに切替済み。よって anon / authenticated の EXECUTE を明示撤回し、全予約作成/変更を
--   サーバ API（＝認証・価格計算・所有権検証を通過した経路）に一本化する。20260605000001 が
--   他の service_role 限定関数に対して行ったのと同一の恒久対策。冪等（REVOKE は何度でも安全）。
--   admin/bookings/route.ts は既に service_role 経由で create_booking_atomic を呼ぶため影響なし。
--
--   ⚠️【本番適用順序（重要）】先に TS デプロイ（Vercel 自動デプロイ）で RPC 呼び出しが
--   service_role 化されたことを確認してから本 SQL を適用すること。逆順で SQL を先に適用すると、
--   デプロイ前の旧コード（anon コンテキストで RPC を呼ぶ）が即座に権限エラーになり予約フローが
--   停止する。DB-1 の REVOKE UPDATE / DROP POLICY は TS 非依存でいつ適用しても安全。
--
--   ※ anon / authenticated は PUBLIC のメンバーのため、PUBLIC の EXECUTE を残したまま
--     anon/authenticated だけ REVOKE しても PUBLIC 経由で実行できてしまう。よって PUBLIC からも
--     必ず REVOKE する。ただし service_role がこれらの関数の EXECUTE を（明示 GRANT ではなく）
--     PUBLIC 既定経由でしか持っていない場合、PUBLIC を剥がすと service_role も実行不能になり
--     サーバ API（service_role 呼び出し）が停止する。既存の GRANT は anon/authenticated のみで
--     service_role への明示付与が無いため、REVOKE の前に service_role へ EXECUTE を明示付与して
--     恒久的に保全する（冪等・既に付与済みでも無害）。
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION create_booking_atomic(
  UUID, UUID, UUID, UUID, UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION change_booking_atomic(
  UUID, UUID, DATE, TIME, TIME
) TO service_role;

REVOKE EXECUTE ON FUNCTION create_booking_atomic(
  UUID, UUID, UUID, UUID, UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, INT, INT, TEXT
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION change_booking_atomic(
  UUID, UUID, DATE, TIME, TIME
) FROM PUBLIC, anon, authenticated;

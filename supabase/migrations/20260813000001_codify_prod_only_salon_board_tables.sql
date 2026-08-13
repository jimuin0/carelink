-- ============================================================================
-- 🔴 接続先ガード（誤ったプロジェクトへ適用したら何も作らずに落ちる）
-- ============================================================================
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION
      'このデータベースは CareLink ではありません（public.facility_profiles が存在しない）。'
      ' 接続先プロジェクトを確認してください。CareLink の本番 ref は xzafxiupbflvgbarrihe です。';
  END IF;
END
$guard$;

-- ============================================================================
-- 掲載ボード由来の本番専用 3 テーブルを migration へ取り込む（2026-08-13）
--   facility_booking_suspensions / facility_daily_capacity / salon_customer_notes
-- ============================================================================
-- 【発見経緯】この 3 テーブルは PR #53（feat/salon-board）が所有していた。当該ブランチには
--   CREATE TABLE migration（20260602_booking_suspensions / 20260602_daily_capacity /
--   20260602_customer_notes）とアプリコードが在り、本番へは 2026-06-03 に先行適用された。
--   main へは未マージだったため main 視点では migration-less に見え、
--   `src/lib/known-prod-only.json` の台帳に載せてフィンガープリント監視から除外していた。
--
-- 🔴 【本移行の契機】その PR #53 は **2026-07-22 に unmerged のままクローズされた**
--   （merged=false / mergeable_state=dirty / 237 files・15472 additions）。台帳と契約テストの
--   docstring は「PR #53 が main へマージされたら台帳から削除すること」と書かれていたが、
--   マージは永久に起きないため、その条件は満たされないまま台帳だけが残り続ける。
--   台帳に載っている間、この 3 テーブルは**何が起きても監視が鳴らない**
--   （列の消失・RLS ポリシーの改変・GRANT の拡大が全て無音）。除外を恒久化するのではなく、
--   定義を main へ back-port して監視下へ戻すのが根治。
--
-- 【本番への影響 = no-op】ここで定義する全オブジェクト（テーブル・制約・インデックス・
--   RLS・ポリシー）は本番に既に存在する。CREATE TABLE IF NOT EXISTS /
--   CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS + CREATE POLICY /
--   ALTER TABLE ... ENABLE ROW LEVEL SECURITY（再実行安全）により、本番への適用は
--   実質何もしない。fresh な shadow / CI DB にだけ新しくオブジェクトを作る。
--
-- 🔴 【DDL は PR #53 の適用済み定義を verbatim で写す】制約名を自分で名付けない。
--   本番の制約名は PR #53 の**無名（インライン）制約から PostgreSQL が自動生成した名前**
--   （facility_booking_suspensions_pkey / _facility_id_fkey / _check、
--     facility_daily_capacity_facility_id_capacity_date_key / _max_bookings_check、
--     salon_customer_notes_facility_id_customer_key_key 等）。同じ書き方をすれば同じ名前が
--   再生成されるが、ここで明示的に命名すると shadow 側だけ別名になり
--   **codify した当日から永久にドリフトを誤報する**。
--
-- 【定義の根拠（独立した 3 系統が一致）】
--   (a) PR #53 の migration 本体（refs/pull/53/head・本番へ適用された当の DDL）
--   (b) 本番 introspection の実測値（列・型・NOT NULL・DEFAULT・制約・索引・ポリシー）
--   (c) src/lib/schema-snapshot.json（本番由来の列一覧）
--   3 者が列・制約・索引・ポリシーまで一致することを確認済み。とくに
--   facility_daily_capacity の索引は (a) が一度作った idx_daily_capacity_facility_date を
--   PR #53 自身の 20260604_daily_capacity_dedup_index.sql が「UNIQUE 由来の索引と重複」として
--   DROP しており、(b) の実測にも存在しない。よって**ここでは作らない**
--   （作ると本番に無い索引が shadow にだけ生まれ、やはり誤報になる）。
--
-- ⚠️ 本 migration は「本番に在るものを main の migration へ写す」だけで、テーブルの
--   存廃そのものは判断していない。PR #53 がクローズされた今、main 側にこの 3 テーブルを
--   参照するアプリコードは 1 行も無い（grep 実測: 型定義・スキーマ台帳・テストのみ）。
--   将来 DROP するかどうかは owner の判断で、本 migration はその判断を先取りしない
--   （DROP は不可逆なので、承認のある #579 と同じ手順を別途踏むこと）。
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) facility_booking_suspensions
--    ネット予約の時間帯指定 一括停止。指定日の時間帯を停止登録し、
--    ネット予約の空き表示・予約確定の双方で当該範囲を除外するための台帳。
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_booking_suspensions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id  UUID NOT NULL REFERENCES public.facility_profiles(id) ON DELETE CASCADE,
  suspend_date DATE NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_booking_suspensions_facility_date
  ON public.facility_booking_suspensions (facility_id, suspend_date);

-- 公開予約フロー(anon クライアント)が停止範囲を参照できるよう SELECT は公開。
-- 書き込みは service_role(管理 API)のみ＝書き込みポリシーを作らず RLS で遮断する。
ALTER TABLE public.facility_booking_suspensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read booking suspensions" ON public.facility_booking_suspensions;
CREATE POLICY "public read booking suspensions" ON public.facility_booking_suspensions FOR SELECT USING (true);

-- --------------------------------------------------------------------------
-- 2) facility_daily_capacity
--    サロンの受付可能枠数（日別）。当日の予約数が上限に達するとネット予約の
--    空き表示・受付を自動停止する。行が無い日は無制限。
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_daily_capacity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id   UUID NOT NULL REFERENCES public.facility_profiles(id) ON DELETE CASCADE,
  capacity_date DATE NOT NULL,
  max_bookings  INT  NOT NULL CHECK (max_bookings >= 0),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (facility_id, capacity_date)
);

-- ⚠️ idx_daily_capacity_facility_date は作らない（上記「定義の根拠」参照）。
--   UNIQUE (facility_id, capacity_date) が同一列の一意インデックスを自動生成するため
--   冗長で、本番でも PR #53 自身の dedup migration で DROP 済み。

-- 公開予約フロー(anon クライアント)が上限を参照できるよう SELECT は公開。
-- 書き込みは service_role(管理 API)のみ。
ALTER TABLE public.facility_daily_capacity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read daily capacity" ON public.facility_daily_capacity;
CREATE POLICY "public read daily capacity" ON public.facility_daily_capacity FOR SELECT USING (true);

-- --------------------------------------------------------------------------
-- 3) salon_customer_notes
--    お客様カルテのメモ／タグ／次回案内。顧客テーブルを持たず予約集計ベースのため、
--    (facility_id, customer_key) で 1 行に保持する。customer_key は予約集計と同じキー
--    （email もしくは氏名を小文字化したもの）。
--
-- 🔴 このテーブルだけポリシーを 1 本も作らない。RLS 有効かつポリシー 0 本
--   ＝ service_role 以外からは 1 行も見えない（PII の施錠）。上の 2 表と違い、
--   メモ・タグ・次回案内は個人情報そのものなので**公開読取を足さないこと**。
--   アクセス制御は API 側（facility_members の owner/admin 検証）が担う。
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.salon_customer_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     UUID NOT NULL REFERENCES public.facility_profiles(id) ON DELETE CASCADE,
  customer_key    TEXT NOT NULL,
  note            TEXT,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  next_visit_date DATE,
  next_visit_note TEXT,
  updated_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (facility_id, customer_key)
);

ALTER TABLE public.salon_customer_notes ENABLE ROW LEVEL SECURITY;

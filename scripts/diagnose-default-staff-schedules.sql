-- =============================================================================
-- スタッフ追加時に黙って作られていた「毎日 09:00〜19:00」の勤務が、今も残っているスタッフを数える
--
-- 【使い方】Supabase Dashboard → SQL Editor に貼って実行する。
--   project ref は必ず xzafxiupbflvgbarrihe（CareLink 本番）であることを確認すること。
--   https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe/sql
--   SQL Editor は postgres 権限で走るので RLS を素通しし、真の全件が見える。
--
-- 【なぜ数えるのか】2026年10月22日の神原さん決定（「店舗によって営業時間もシフトも違う」）で、
--   スタッフを追加しても勤務を自動では作らないようにした（migration 20261023080100）。
--   ただし既存のスタッフの勤務は書き換えていない（データ移行なし）。以前に追加したスタッフは、
--   オーナーが一度も勤務を保存していなければ「毎日 09:00〜19:00」のままで、
--   ・19:00 以降 / 09:00 より前の予約枠が出ない
--   ・本当は休みの曜日でも、店舗の営業日なら予約が入る
--   状態が続いている。該当するスタッフと店舗を出し、オーナーへ見直しを案内するために使う。
--
-- 【読み方】「既定のまま」が true のスタッフが対象。勤務の保存回数は 2026年10月8日以降の
--   保存だけを数える（それより前の保存は記録が無い）ので、0 でも保存していないとは限らない。
--   店舗の営業時間と並べて見て判断する。
--
-- 【安全性】本ファイルは SELECT のみ。1行も書き換えない。
--
-- @check staff_profiles.id
-- @check staff_profiles.facility_id
-- @check staff_profiles.name
-- @check staff_profiles.is_active
-- @check staff_schedules.id
-- @check staff_schedules.staff_id
-- @check staff_schedules.start_time
-- @check staff_schedules.end_time
-- @check staff_mutation_operations.staff_id
-- @check staff_mutation_operations.kind
-- @check facility_profiles.id
-- @check facility_profiles.name
-- @check facility_profiles.status
-- @check facility_profiles.business_hours
-- =============================================================================

-- =============================================================================
-- 接続先の自己検査。
-- Supabase の SQL Editor はプロジェクトごとにタブが開くため、【別プロジェクトのタブに
-- 貼ってしまう】事故が繰り返し起きている（2026年8月2日 soel で実行し「RLS が90本欠落」
-- という存在しない事故を報告しかけた／2026年8月12日 admin-dashboard で実行し
-- 「audit_logs が存在しない」となった）。人の注意力では防げないので、SQL 自身に検査させる。
--
-- CareLink 本番 project ref = xzafxiupbflvgbarrihe
-- 目印テーブルが揃っていなければ、以降を1行も実行せずに落とす。
-- =============================================================================
DO $connguard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL
     OR to_regclass('public.facility_menus') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION
      '接続先が CareLink 本番ではありません。project ref = xzafxiupbflvgbarrihe のタブで実行してください（現在の接続先には facility_profiles / facility_menus / audit_logs のいずれかがありません）';
  END IF;
END
$connguard$;

-- (1) 件数のまとめ（在籍スタッフのみ）。
with staff_week as (
  select sp.id as staff_id,
         count(ss.id) as days,
         count(ss.id) filter (where ss.start_time = '09:00' and ss.end_time = '19:00') as default_days
  from public.staff_profiles sp
  left join public.staff_schedules ss on ss.staff_id = sp.id
  where sp.is_active
  group by sp.id
)
select
  count(*)                                              as 在籍スタッフ,
  count(*) filter (where days = 7 and default_days = 7) as 既定の毎日9時19時のまま,
  count(*) filter (where days = 0)                      as 勤務未登録_予約を受けられない
from staff_week;

-- (2) 店舗・スタッフごとの明細。「既定のまま」が true の行が見直しの対象。
with staff_week as (
  select sp.id as staff_id, sp.facility_id, sp.name,
         count(ss.id) as days,
         count(ss.id) filter (where ss.start_time = '09:00' and ss.end_time = '19:00') as default_days
  from public.staff_profiles sp
  left join public.staff_schedules ss on ss.staff_id = sp.id
  where sp.is_active
  group by sp.id, sp.facility_id, sp.name
),
weekly_saves as (
  select staff_id, count(*) as saves
  from public.staff_mutation_operations
  where kind = 'weekly'
  group by staff_id
)
select f.name                                   as 店舗,
       f.status                                 as 公開状態,
       w.name                                   as スタッフ,
       w.days                                   as 勤務日数,
       (w.days = 7 and w.default_days = 7)      as 既定のまま,
       coalesce(s.saves, 0)                     as 勤務の保存回数_10月8日以降,
       f.business_hours                         as 店舗の営業時間
from staff_week w
join public.facility_profiles f on f.id = w.facility_id
left join weekly_saves s on s.staff_id = w.staff_id
order by (w.days = 7 and w.default_days = 7) desc, f.name, w.name;

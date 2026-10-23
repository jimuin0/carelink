-- =============================================================================
-- migration 20261023180000 / migration 20261023190000 を本番へ適用する前の確認：
-- 「今ネット予約を受けている公開店舗が、適用後も受け続けるか」
-- （2026年10月23日更新：20261023190000 の規則＝最短のメニュー以上の重なりで判定する。
--   20261023180000 だけを適用する前に使っても、より厳しい側で判定するので見落としは出ない）
--
-- 【使い方】Supabase Dashboard → SQL Editor に貼って実行する。
--   project ref は必ず xzafxiupbflvgbarrihe（CareLink 本番）であることを確認すること。
--   https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe/sql
--   SQL Editor は postgres 権限で走るので RLS を素通しし、真の全件が見える。
--
-- 【何が変わるか】20261023180000 から、スタッフが「予約を受けられる」のは、勤務の窓（週間の勤務日、
--   または今日以降に勤務する特別日）が、その曜日の店舗の営業時間の中に少しでも残るときだけになる
--   （予約枠＝get_available_slots は営業時間で切り詰め、定休日は枠を出さないため）。営業時間の外にしか
--   勤務が無いスタッフしかいない店舗は、ネット予約が「準備中」に戻り、検索カードの「予約OK」も消える。
--   20261023190000 からは、営業時間の中に残る長さが【店舗の最短のメニュー】以上であることも要る
--   （予約枠は、切り詰めた勤務の窓に所要時間がまるごと入るときだけ出るため）。最短のメニューは、
--   予約できるメニュー（is_published が false 以外）1つずつの所要時間（未設定・0 は 60 分、15〜480 分に
--   丸める＝予約画面と同じ）の最小値。予約できるメニューが無い店舗は 15 分。
--
-- 【読み方】(1) の「適用後に予約を受けられなくなる店舗」が 0 なら、そのまま適用してよい。
--   1 以上なら (2) の明細の店舗に、スタッフの勤務時間か営業時間の見直しを案内してから適用する
--   （その店舗は今も予約画面が毎日「満枠」のはず＝適用で事実と表示が揃うだけ、という確認にもなる）。
--   判定式は migration の public.working_time_meets_business_hours（5 引数）と
--   public.facility_shortest_booking_minutes と同じ（この SQL は関数を作らずに CASE で同じことをする。
--   適用前の本番にはその関数が無いため）。
--
-- 【安全性】本ファイルは SELECT のみ。1行も書き換えない。
--
-- @check facility_profiles.id
-- @check facility_profiles.name
-- @check facility_profiles.status
-- @check facility_profiles.business_hours
-- @check staff_profiles.id
-- @check staff_profiles.facility_id
-- @check staff_profiles.is_active
-- @check staff_schedules.staff_id
-- @check staff_schedules.day_of_week
-- @check staff_schedules.start_time
-- @check staff_schedules.end_time
-- @check schedule_overrides.staff_id
-- @check schedule_overrides.date
-- @check schedule_overrides.is_holiday
-- @check schedule_overrides.start_time
-- @check schedule_overrides.end_time
-- @check facility_menus.facility_id
-- @check facility_menus.duration_minutes
-- @check facility_menus.is_published
-- =============================================================================

-- =============================================================================
-- 接続先の自己検査（別プロジェクトのタブに貼る事故を SQL 自身に防がせる）。
-- CareLink 本番 project ref = xzafxiupbflvgbarrihe
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

-- (1) まとめ。
with windows as (
  select sp.facility_id, sp.id as staff_id, ss.day_of_week as dow, ss.start_time as s, ss.end_time as e
  from public.staff_profiles sp
  join public.staff_schedules ss on ss.staff_id = sp.id
  where sp.is_active
  union all
  select sp.facility_id, sp.id, extract(dow from so.date)::int, so.start_time, so.end_time
  from public.staff_profiles sp
  join public.schedule_overrides so on so.staff_id = sp.id
  where sp.is_active
    and so.date >= (now() at time zone 'Asia/Tokyo')::date
    and so.is_holiday is not true and so.start_time is not null and so.end_time is not null
),
judged as (
  select w.facility_id, w.staff_id,
    case
      when f.business_hours is null or jsonb_typeof(f.business_hours) <> 'object' then w.e - w.s >= make_interval(mins => need.minutes)
      when f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1] is null then w.e - w.s >= make_interval(mins => need.minutes)
      when jsonb_typeof(f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) = 'null' then false
      when (f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) ->> 'open' is null
        or (f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) ->> 'close' is null then w.e - w.s >= make_interval(mins => need.minutes)
      when (f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) ->> 'open' !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        or (f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) ->> 'close' !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then false
      else least(w.e, ((f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) ->> 'close')::time)
         - greatest(w.s, ((f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) ->> 'open')::time)
         >= make_interval(mins => need.minutes)
    end as meets_hours
  from windows w
  join public.facility_profiles f on f.id = w.facility_id
  cross join lateral (
    -- 店舗の最短のメニュー（public.facility_shortest_booking_minutes と同じ式）
    select coalesce(min(least(greatest(coalesce(nullif(m.duration_minutes, 0), 60), 15), 480))::int, 15) as minutes
    from public.facility_menus m
    where m.facility_id = w.facility_id and m.is_published is distinct from false
  ) need
),
per_facility as (
  select f.id, f.name,
    public.facility_booking_ready(f.id) as ready_now,
    (select count(distinct j.staff_id) from judged j where j.facility_id = f.id) as staff_with_any_window,
    (select count(distinct j.staff_id) from judged j where j.facility_id = f.id and j.meets_hours) as staff_inside_hours
  from public.facility_profiles f
  where f.status = 'published'
)
select
  (to_regclass('public.facility_profiles') is not null)                 as is_carelink,
  count(*)                                                               as 公開店舗,
  count(*) filter (where ready_now)                                      as 今ネット予約を受けている店舗,
  count(*) filter (where ready_now and staff_inside_hours = 0)           as 適用後に予約を受けられなくなる店舗
from per_facility;

-- (2) 公開店舗ごとの明細。「適用後も受けられる」が false で「今受けている」が true の店舗が案内の対象。
with windows as (
  select sp.facility_id, sp.id as staff_id, ss.day_of_week as dow, ss.start_time as s, ss.end_time as e
  from public.staff_profiles sp
  join public.staff_schedules ss on ss.staff_id = sp.id
  where sp.is_active
  union all
  select sp.facility_id, sp.id, extract(dow from so.date)::int, so.start_time, so.end_time
  from public.staff_profiles sp
  join public.schedule_overrides so on so.staff_id = sp.id
  where sp.is_active
    and so.date >= (now() at time zone 'Asia/Tokyo')::date
    and so.is_holiday is not true and so.start_time is not null and so.end_time is not null
),
judged as (
  select w.facility_id, w.staff_id,
    case
      when f.business_hours is null or jsonb_typeof(f.business_hours) <> 'object' then w.e - w.s >= make_interval(mins => need.minutes)
      when f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1] is null then w.e - w.s >= make_interval(mins => need.minutes)
      when jsonb_typeof(f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) = 'null' then false
      when (f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) ->> 'open' is null
        or (f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) ->> 'close' is null then w.e - w.s >= make_interval(mins => need.minutes)
      when (f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) ->> 'open' !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        or (f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) ->> 'close' !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then false
      else least(w.e, ((f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) ->> 'close')::time)
         - greatest(w.s, ((f.business_hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[w.dow + 1]) ->> 'open')::time)
         >= make_interval(mins => need.minutes)
    end as meets_hours
  from windows w
  join public.facility_profiles f on f.id = w.facility_id
  cross join lateral (
    -- 店舗の最短のメニュー（public.facility_shortest_booking_minutes と同じ式）
    select coalesce(min(least(greatest(coalesce(nullif(m.duration_minutes, 0), 60), 15), 480))::int, 15) as minutes
    from public.facility_menus m
    where m.facility_id = w.facility_id and m.is_published is distinct from false
  ) need
)
select f.id, f.name,
  public.facility_booking_ready(f.id)                                                       as 今受けている,
  (select count(distinct j.staff_id) from judged j where j.facility_id = f.id)               as 勤務の窓があるスタッフ,
  (select count(distinct j.staff_id) from judged j where j.facility_id = f.id and j.meets_hours) as 営業時間内に勤務するスタッフ,
  public.facility_booking_ready(f.id)
    and (select count(*) from judged j where j.facility_id = f.id and j.meets_hours) > 0     as 適用後も受けられる,
  f.business_hours
from public.facility_profiles f
where f.status = 'published'
order by 適用後も受けられる, f.name;

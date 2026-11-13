-- 点検 A105（2026年11月13日）：20261026040703 の置換が「片方だけ当たった」状態を検出する。
--
-- 20261026040703 の DO $buffers$ は pg_get_functiondef + replace() で
--   (1) 日付の範囲拡大（booking_date = p_booking_date → BETWEEN p_booking_date-1 AND p_booking_date+1）と
--   (2) 日付つきの比較（start_time < p_end_time + … → booking_date + start_time < p_booking_date + p_end_time + …）
-- を別々に当てているが、replace() は一致しなくても黙って何もしないので、(1) だけが当たると
-- 「前後 1 日の予約を、日付を見ずに時刻だけで重なり判定する」状態（隣の日の予約と誤って衝突する／
-- 日付をまたぐ重なりを見逃す）になっても検知できなかった。
--
-- この migration は【何も変更しない】。現在の関数本文に、置換前の「時刻だけの比較」が 1 つでも残っていて、
-- しかも日付の範囲が拡大されていれば失敗させる（整合していれば NOTICE も出さずに通る）。
-- 判定には 20261026040703 の置換元の文字列そのもの（$old$ 側）を使う。後続 migration が本文を書き直していても、
-- 置換元の文字列が復活していない限り誤検知しない。
-- 適用順序：コード変更なし。いつ適用してもよい（1 段目）。失敗したら、該当関数の最新定義を写した
-- CREATE OR REPLACE で直す（20261023180000 の方式。置換方式を重ねない）。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

DO $assert$
DECLARE r record; widened boolean; time_only boolean; unwidened boolean;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname, p.prosrc
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = ANY (ARRAY['create_booking_for_menus_atomic','change_booking_atomic','get_available_slots',
                                         'booking_pick_free_staff','booking_unassigned_capacity_full'])
  LOOP
    widened := strpos(r.prosrc, 'booking_date BETWEEN p_booking_date-1 AND p_booking_date+1') > 0
            OR strpos(r.prosrc, 'b.booking_date BETWEEN p_date-1 AND p_date+1') > 0;
    unwidened := strpos(r.prosrc, 'AND booking_date = p_booking_date') > 0
              OR strpos(r.prosrc, 'b.booking_date = p_date') > 0;
    time_only := strpos(r.prosrc, $old$start_time < p_end_time + (v_buffer_minutes || ' minutes')::INTERVAL$old$) > 0
              OR strpos(r.prosrc, $old$end_time + (v_buffer_minutes || ' minutes')::INTERVAL > p_start_time$old$) > 0
              OR strpos(r.prosrc, $old$b.start_time < v_current_end + (v_buffer_minutes || ' minutes')::INTERVAL$old$) > 0
              OR strpos(r.prosrc, $old$b.end_time + (v_buffer_minutes || ' minutes')::INTERVAL > v_current_start$old$) > 0
              OR strpos(r.prosrc, $old$b.start_time < p_end + (COALESCE(p_buffer_minutes, 0) || ' minutes')::interval$old$) > 0
              OR strpos(r.prosrc, $old$b.end_time + (COALESCE(p_buffer_minutes, 0) || ' minutes')::interval > p_start$old$) > 0;
    IF widened AND time_only THEN
      RAISE EXCEPTION 'business periods overlap patch incomplete in %: date window widened but times compared without dates', r.sig;
    END IF;
    IF unwidened AND NOT time_only AND NOT widened THEN
      RAISE NOTICE '% compares absolute times but its booking_date window was not widened (stricter, review)', r.sig;
    END IF;
  END LOOP;
END $assert$;

/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 勤務時間・営業時間を保存したときの注意（保存は止めない・2026年10月23日）。
 * 予約枠は営業時間の中にしか出ないため、営業時間（定休日を含む）と重ならない勤務は保存できても
 * 予約を受けられない。判定は予約枠・検索カードと同じ workingTimeMeetsBusinessHours。
 */
import {
  hoursSaveStaffWarning, NO_STAFF_INSIDE_HOURS_WARNING, specialDayHoursWarning, specialDaySaveWarning,
  weeklyScheduleHoursWarning, weeklyScheduleSaveWarning,
} from '../staff-hours-warning';

const HOURS = { mon: { open: '10:00', close: '18:00' }, tue: null, wed: { open: '10:00', close: '18:00' }, thu: null, fri: null, sat: null, sun: null };

describe('weeklyScheduleHoursWarning', () => {
  test('全部重なれば注意しない', () => {
    expect(weeklyScheduleHoursWarning(HOURS, [{ day_of_week: 1, start_time: '09:00', end_time: '12:00' }])).toBeNull();
    expect(weeklyScheduleHoursWarning(HOURS, [])).toBeNull();
  });
  test('重ならない曜日だけを曜日順に挙げる', () => {
    expect(weeklyScheduleHoursWarning(HOURS, [
      { day_of_week: 3, start_time: '18:00', end_time: '20:00' },
      { day_of_week: 1, start_time: '09:00', end_time: '12:00' },
      { day_of_week: 0, start_time: '09:00', end_time: '12:00' },
    ])).toBe('日・水曜の勤務時間は、店舗の営業時間（定休日を含む）の中に最短のメニュー（15分）が入る長さがないため、その曜日はネット予約の枠が出ません。');
  });
  test('どの曜日も重ならなければ、予約を受けられないことまで知らせる', () => {
    expect(weeklyScheduleHoursWarning(HOURS, [{ day_of_week: 2, start_time: '09:00', end_time: '12:00' }]))
      .toBe('火曜の勤務時間は、店舗の営業時間（定休日を含む）の中に最短のメニュー（15分）が入る長さがないため、その曜日はネット予約の枠が出ません。このままでは、このスタッフは週間の勤務ではネット予約を受けられません。店舗の営業時間か勤務時間を見直してください。');
  });
  test('最短のメニューより短い重なりも知らせる（20261023190000）', () => {
    // 月曜 10:00-18:00 に 09:00-10:30＝30 分
    const monday = [{ day_of_week: 1, start_time: '09:00', end_time: '10:30' }];
    expect(weeklyScheduleHoursWarning(HOURS, monday, 30)).toBeNull();
    expect(weeklyScheduleHoursWarning(HOURS, monday, 60)).toBe('月曜の勤務時間は、店舗の営業時間（定休日を含む）の中に最短のメニュー（60分）が入る長さがないため、その曜日はネット予約の枠が出ません。このままでは、このスタッフは週間の勤務ではネット予約を受けられません。店舗の営業時間か勤務時間を見直してください。');
    expect(specialDayHoursWarning(HOURS, '2030-01-07', '17:30', '19:00', 60)).toBe('この特別日の勤務時間は、店舗の営業時間（定休日を含む）の中に最短のメニュー（60分）が入る長さがないため、この日はネット予約の枠が出ません。');
    expect(specialDayHoursWarning(HOURS, '2030-01-07', '17:00', '19:00', 60)).toBeNull();
  });
  test('営業時間が未設定なら切り詰めない（予約枠と同じ）', () => {
    expect(weeklyScheduleHoursWarning(null, [{ day_of_week: 0, start_time: '09:00', end_time: '12:00' }])).toBeNull();
  });
});

describe('specialDayHoursWarning', () => {
  test('定休日（2030-01-08 は火曜）なら知らせる・営業日の中なら知らせない', () => {
    expect(specialDayHoursWarning(HOURS, '2030-01-08', '10:00', '12:00')).toBe('この特別日の勤務時間は、店舗の営業時間（定休日を含む）の中に最短のメニュー（15分）が入る長さがないため、この日はネット予約の枠が出ません。');
    expect(specialDayHoursWarning(HOURS, '2030-01-07', '10:00', '12:00')).toBeNull();
  });
});

/** .from(table).select().eq()... を thenable / maybeSingle で解決する小さな偽クライアント。 */
function client(tables: Record<string, { data: unknown; error: unknown } | (() => never)>) {
  return {
    from: (table: string) => {
      const result = tables[table];
      if (typeof result === 'function') return result();
      const obj: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'gte', 'not', 'limit', 'or']) obj[method] = () => obj;
      obj.maybeSingle = () => Promise.resolve(result);
      obj.then = (resolve: (v: unknown) => unknown) => resolve(result);
      return obj;
    },
  } as never;
}
const window = (start: string, end: string) => [{ id: 's1', staff_schedules: [{ day_of_week: 1, start_time: start, end_time: end }], schedule_overrides: [] }];

describe('hoursSaveStaffWarning', () => {
  test('勤務時間を保存したスタッフがいて、誰の勤務も営業時間と重ならなければ知らせる', async () => {
    await expect(hoursSaveStaffWarning(client({
      staff_profiles: { data: window('07:00:00', '10:00:00'), error: null },
      facility_profiles: { data: [{ business_hours: HOURS }], error: null },
      facility_menus: { data: [], error: null },
    }), 'f1')).resolves.toBe(NO_STAFF_INSIDE_HOURS_WARNING);
    // 30 分しか重ならない勤務も、最短のメニューが 60 分なら同じ注意
    await expect(hoursSaveStaffWarning(client({
      staff_profiles: { data: window('09:00:00', '10:30:00'), error: null },
      facility_profiles: { data: [{ business_hours: HOURS }], error: null },
      facility_menus: { data: [{ duration_minutes: 60 }], error: null },
    }), 'f1')).resolves.toBe(NO_STAFF_INSIDE_HOURS_WARNING);
  });
  test('重なるスタッフがいれば・勤務時間が 1 件も無ければ知らせない', async () => {
    await expect(hoursSaveStaffWarning(client({
      staff_profiles: { data: window('09:00:00', '12:00:00'), error: null },
      facility_profiles: { data: [{ business_hours: HOURS }], error: null },
      facility_menus: { data: [], error: null },
    }), 'f1')).resolves.toBeNull();
    await expect(hoursSaveStaffWarning(client({
      staff_profiles: { data: [{ id: 's1', staff_schedules: [], schedule_overrides: [] }], error: null },
      facility_profiles: { data: [{ business_hours: HOURS }], error: null },
      facility_menus: { data: [], error: null },
    }), 'f1')).resolves.toBeNull();
  });
  test('読めなければ知らせない（保存の結果を変えない）', async () => {
    await expect(hoursSaveStaffWarning(client({
      staff_profiles: { data: null, error: { message: 'down' } },
      facility_profiles: { data: [{ business_hours: HOURS }], error: null },
    }), 'f1')).resolves.toBeNull();
  });
});

describe('保存後の注意は、営業時間を読めなければ出さない', () => {
  const schedules = [{ day_of_week: 2, start_time: '09:00', end_time: '12:00' }];
  test('週間の勤務', async () => {
    const menus = { data: [{ duration_minutes: 60 }], error: null };
    await expect(weeklyScheduleSaveWarning(client({ facility_profiles: { data: { business_hours: HOURS }, error: null }, facility_menus: menus }), 'f1', schedules))
      .resolves.toContain('火曜の勤務時間は、店舗の営業時間（定休日を含む）の中に最短のメニュー（60分）');
    // メニューを読めなければ注意を出さない（最短の長さを取り違えない）
    await expect(weeklyScheduleSaveWarning(client({ facility_profiles: { data: { business_hours: HOURS }, error: null },
      facility_menus: { data: null, error: { message: 'down' } } }), 'f1', schedules)).resolves.toBeNull();
    // 営業時間の列が無い（未設定）なら切り詰めない＝注意なし
    await expect(weeklyScheduleSaveWarning(client({ facility_profiles: { data: {}, error: null }, facility_menus: menus }), 'f1', schedules)).resolves.toBeNull();
    await expect(weeklyScheduleSaveWarning(client({ facility_profiles: { data: null, error: null } }), 'f1', schedules)).resolves.toBeNull();
    await expect(weeklyScheduleSaveWarning(client({ facility_profiles: { data: null, error: { message: 'down' } } }), 'f1', schedules)).resolves.toBeNull();
    await expect(weeklyScheduleSaveWarning(client({ facility_profiles: () => { throw new Error('network'); } }), 'f1', schedules)).resolves.toBeNull();
  });
  test('勤務する特別日', async () => {
    await expect(specialDaySaveWarning(client({ facility_profiles: { data: { business_hours: HOURS }, error: null }, facility_menus: { data: [], error: null } }), 'f1', '2030-01-08', '10:00', '12:00'))
      .resolves.toContain('この特別日の勤務時間');
    await expect(specialDaySaveWarning(client({ facility_profiles: { data: null, error: { message: 'down' } } }), 'f1', '2030-01-08', '10:00', '12:00'))
      .resolves.toBeNull();
  });
});

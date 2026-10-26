/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { suggestStaffWeekFromBusinessHours } from '../staff-schedule-suggestion';

test('確定済みの営業時間を曜日ごとに写し、定休日は休みのまま（09:00〜19:00 を持ち込まない）', () => {
  const hours = {
    mon: null, tue: { open: '10:00', close: '20:00' }, wed: { open: '10:00', close: '20:00' }, thu: { open: '11:00', close: '21:00' },
    fri: { open: '10:00', close: '20:00' }, sat: { open: '09:30', close: '18:00' }, sun: null,
  };
  expect(suggestStaffWeekFromBusinessHours(hours)).toEqual([
    // 休みの曜日の時間は、チェックを入れたときの初期表示（その店舗の最初の営業日の時間）
    { day_of_week: 0, enabled: false, start_time: '10:00', end_time: '20:00' },
    { day_of_week: 1, enabled: false, start_time: '10:00', end_time: '20:00' },
    { day_of_week: 2, enabled: true, start_time: '10:00', end_time: '20:00' },
    { day_of_week: 3, enabled: true, start_time: '10:00', end_time: '20:00' },
    { day_of_week: 4, enabled: true, start_time: '11:00', end_time: '21:00' },
    { day_of_week: 5, enabled: true, start_time: '10:00', end_time: '20:00' },
    { day_of_week: 6, enabled: true, start_time: '09:30', end_time: '18:00' },
  ]);
});

test.each([
  ['未設定', null],
  ['曜日の欠け（未確定）', { mon: { open: '10:00', close: '20:00' } }],
  ['全曜日が定休日', { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }],
])('営業時間が%sなら下書きを作らない', (_label, hours) => {
  expect(suggestStaffWeekFromBusinessHours(hours)).toBeNull();
});

test('split business hours do not silently create a staff shift covering the break', () => {
  const hours = { mon: { open: '09:00', close: '12:00', periods: [{ open: '09:00', close: '12:00' }, { open: '15:00', close: '18:00' }] }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
  expect(suggestStaffWeekFromBusinessHours(hours)).toBeNull();
});

/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  REMINDER_SEND_HOUR_JST, REMINDER_EMAIL_TIMING_NOTE, REMINDER_LINE_TIMING_NOTE,
  isReminderSendHour, jstHour,
} from '../reminder-schedule';

test('JST の時は UTC+9 で求め、日付をまたいでも正しい', () => {
  expect(jstHour(new Date('2026-05-15T00:05:00Z'))).toBe(9);
  expect(jstHour(new Date('2026-05-14T15:05:00Z'))).toBe(0);
  expect(jstHour(new Date('2026-05-14T23:59:59Z'))).toBe(8);
});

test.each([
  ['2026-05-15T00:00:00Z', true],
  ['2026-05-15T00:59:59Z', true],
  ['2026-05-14T23:59:59Z', false],
  ['2026-05-15T01:00:00Z', false],
  ['2026-05-14T15:05:00Z', false],
])('%s は送信時刻か → %s', (iso, expected) => {
  expect(isReminderSendHour(new Date(iso))).toBe(expected);
});

test('文面の説明は送信時刻（9時）と一致している', () => {
  expect(REMINDER_SEND_HOUR_JST).toBe(9);
  expect(REMINDER_EMAIL_TIMING_NOTE).toBe('本メールは、当日朝9時の時点でご予約いただいているお客様にお送りしています。');
  expect(REMINDER_EMAIL_TIMING_NOTE).toContain(`${REMINDER_SEND_HOUR_JST}時`);
  expect(REMINDER_LINE_TIMING_NOTE).toContain(`${REMINDER_SEND_HOUR_JST}時`);
});

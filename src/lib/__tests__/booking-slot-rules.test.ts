/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 予約枠の長さと「もう始まった枠か」の単一ソース（2026年10月23日）。
 * 予約画面・空き枠 API・予約 API・日時変更が同じ値を使うことを、境界ごとに固定する。
 */
import {
  BOOKING_DURATION_MAX_MINUTES, BOOKING_DURATION_MIN_MINUTES, BOOKING_DURATION_MISMATCH_MESSAGE, BOOKING_SLOT_PASSED_MESSAGE,
  MENU_DURATION_FALLBACK_MINUTES, RESCHEDULE_DURATION_MISMATCH_MESSAGE, bookingDurationForMenus, clampBookingDuration,
  clockMinutes, hasSlotStarted, needsSlotReselection, rescheduleDurationMinutes, slotLengthMinutes,
} from '../booking-slot-rules';

describe('clampBookingDuration', () => {
  test('空き枠 RPC と同じ 15〜480 分に丸める', () => {
    expect([BOOKING_DURATION_MIN_MINUTES, BOOKING_DURATION_MAX_MINUTES, MENU_DURATION_FALLBACK_MINUTES]).toEqual([15, 480, 60]);
    expect(clampBookingDuration(5)).toBe(15);
    expect(clampBookingDuration(15)).toBe(15);
    expect(clampBookingDuration(90)).toBe(90);
    expect(clampBookingDuration(480)).toBe(480);
    expect(clampBookingDuration(600)).toBe(480);
  });
  test('小数は切り捨て、数値でなければ 60 分', () => {
    expect(clampBookingDuration(90.9)).toBe(90);
    expect(clampBookingDuration(Number.NaN)).toBe(60);
    expect(clampBookingDuration(Number.POSITIVE_INFINITY)).toBe(60);
  });
});

describe('bookingDurationForMenus（予約画面が空き枠を取る長さ）', () => {
  test('選んだメニューの所要時間の合計', () => {
    expect(bookingDurationForMenus([{ duration_minutes: 60 }, { duration_minutes: 30 }])).toBe(90);
  });
  test('所要時間が未設定（null・0・項目なし）のメニューは 60 分', () => {
    expect(bookingDurationForMenus([{ duration_minutes: null }, { duration_minutes: 0 }, {}])).toBe(180);
  });
  test('合計も 15〜480 分に丸める（メニューなしは 15 分）', () => {
    expect(bookingDurationForMenus([{ duration_minutes: 300 }, { duration_minutes: 300 }])).toBe(480);
    expect(bookingDurationForMenus([{ duration_minutes: 10 }])).toBe(15);
    expect(bookingDurationForMenus([])).toBe(15);
  });
});

describe('clockMinutes / slotLengthMinutes', () => {
  test('"HH:MM" と "HH:MM:SS"（空き枠 RPC の形）を同じに読む', () => {
    expect(clockMinutes('09:30')).toBe(570);
    expect(clockMinutes('9:30')).toBe(570);
    expect(clockMinutes('14:00:00')).toBe(840);
    expect(slotLengthMinutes('14:00:00', '15:00:00')).toBe(60);
    expect(slotLengthMinutes('14:00', '16:00:00')).toBe(120);
  });
  test('読めない時刻は NaN（どの所要時間とも一致しない）', () => {
    expect(clockMinutes('')).toBeNaN();
    expect(clockMinutes('14時')).toBeNaN();
    expect(slotLengthMinutes('bad', '15:00')).toBeNaN();
  });
});

describe('rescheduleDurationMinutes（日時変更は予約の今の長さを保つ）', () => {
  test('start/end の差', () => {
    expect(rescheduleDurationMinutes('10:00:00', '12:00:00')).toBe(120);
  });
  test('長さが 0 以下・読めない予約は 60 分（変更画面と同じ）', () => {
    expect(rescheduleDurationMinutes('10:00:00', '10:00:00')).toBe(60);
    expect(rescheduleDurationMinutes('11:00:00', '10:00:00')).toBe(60);
    expect(rescheduleDurationMinutes('bad', '10:00:00')).toBe(60);
  });
  test('空き枠 RPC の範囲に丸める', () => {
    expect(rescheduleDurationMinutes('10:00:00', '10:10:00')).toBe(15);
    expect(rescheduleDurationMinutes('08:00:00', '18:00:00')).toBe(480);
  });
});

describe('hasSlotStarted（JST）', () => {
  // 2026-10-22 14:00 JST
  const now = Date.parse('2026-10-22T05:00:00Z');
  test('開始時刻を過ぎた枠・ちょうどの枠は過ぎた扱い（空き枠 API は slot_start > 今 だけを出す）', () => {
    expect(hasSlotStarted('2026-10-22', '13:30', now)).toBe(true);
    expect(hasSlotStarted('2026-10-22', '14:00:00', now)).toBe(true);
    expect(hasSlotStarted('2026-10-21', '23:30', now)).toBe(true);
  });
  test('まだ始まっていない枠', () => {
    expect(hasSlotStarted('2026-10-22', '14:30', now)).toBe(false);
    expect(hasSlotStarted('2026-10-23', '09:00', now)).toBe(false);
  });
  test('UTC では前日でも JST の日付で判定する（JST 0 時台）', () => {
    // 2026-10-22 00:30 JST = 2026-10-21 15:30 UTC
    expect(hasSlotStarted('2026-10-22', '00:00', Date.parse('2026-10-21T15:30:00Z'))).toBe(true);
    expect(hasSlotStarted('2026-10-22', '01:00', Date.parse('2026-10-21T15:30:00Z'))).toBe(false);
  });
  test('読めない日時は過ぎていない扱い（最終判定は DB）', () => {
    expect(hasSlotStarted('bad', '10:00', now)).toBe(false);
  });
});

describe('needsSlotReselection', () => {
  test.each([BOOKING_SLOT_PASSED_MESSAGE, BOOKING_DURATION_MISMATCH_MESSAGE, RESCHEDULE_DURATION_MISMATCH_MESSAGE])('%s → 選び直し', (message) => {
    expect(needsSlotReselection(message)).toBe(true);
  });
  test.each(['この時間帯は既に予約が入っています', '', null, undefined])('%p → そのまま', (message) => {
    expect(needsSlotReselection(message)).toBe(false);
  });
});

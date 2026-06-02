/**
 * @jest-environment node
 *
 * Tests for lib/suspensions.ts（予約停止時間帯の判定ヘルパー #03/#09/#10）
 */
import { timeToMinutes, rangesOverlap, isRangeSuspended } from '../suspensions';

describe('timeToMinutes', () => {
  test('HH:MM を分に変換', () => { expect(timeToMinutes('10:30')).toBe(630); });
  test('HH:MM:SS も先頭2要素で変換', () => { expect(timeToMinutes('09:00:00')).toBe(540); });
  test('不正値は 0 扱い', () => { expect(timeToMinutes('xx:yy')).toBe(0); });
});

describe('rangesOverlap', () => {
  test('重なる', () => { expect(rangesOverlap(600, 660, 630, 690)).toBe(true); });
  test('内包', () => { expect(rangesOverlap(600, 720, 630, 660)).toBe(true); });
  test('端点接触は重ならない', () => { expect(rangesOverlap(600, 630, 630, 660)).toBe(false); });
  test('完全に別', () => { expect(rangesOverlap(600, 630, 700, 730)).toBe(false); });
});

describe('isRangeSuspended', () => {
  const sus = [{ start_time: '12:00', end_time: '13:00' }, { start_time: '18:00:00', end_time: '19:00:00' }];
  test('停止範囲に重なる → true', () => { expect(isRangeSuspended('12:30', '13:30', sus)).toBe(true); });
  test('別範囲(SS付き)に重なる → true', () => { expect(isRangeSuspended('18:30', '18:45', sus)).toBe(true); });
  test('どの範囲とも重ならない → false', () => { expect(isRangeSuspended('14:00', '15:00', sus)).toBe(false); });
  test('停止なし → false', () => { expect(isRangeSuspended('12:30', '13:30', [])).toBe(false); });
});

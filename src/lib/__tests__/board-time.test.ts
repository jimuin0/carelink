import {
  timeToMinutes,
  minutesToTime,
  snapToSlot,
  computeEndMinutes,
  endExceedsClose,
} from '@/lib/board-time';

describe('timeToMinutes', () => {
  it('正常な HH:MM を分に変換', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('10:00')).toBe(600);
    expect(timeToMinutes('23:30')).toBe(1410);
  });
  it('分が欠落/不正トークンは 0 扱い（NaN を出さない）', () => {
    expect(timeToMinutes('10')).toBe(600);
    expect(timeToMinutes('aa:bb')).toBe(0);
    expect(timeToMinutes('')).toBe(0);
  });
});

describe('minutesToTime', () => {
  it('分を HH:MM（0詰め）に変換', () => {
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(90)).toBe('01:30');
    expect(minutesToTime(600)).toBe('10:00');
    expect(minutesToTime(1410)).toBe('23:30');
  });
  it('24:00 以上も素直に表現する（営業時間超の判定は別関数）', () => {
    expect(minutesToTime(1440)).toBe('24:00');
    expect(minutesToTime(1530)).toBe('25:30');
  });
});

describe('snapToSlot', () => {
  it('30分グリッドに切り捨てスナップ', () => {
    expect(snapToSlot(600)).toBe(600);
    expect(snapToSlot(629)).toBe(600);
    expect(snapToSlot(630)).toBe(630);
  });
  it('slotMin を指定できる', () => {
    expect(snapToSlot(615, 60)).toBe(600);
  });
});

describe('computeEndMinutes', () => {
  it('開始＋施術合計', () => {
    expect(computeEndMinutes(600, 60)).toBe(660);
    expect(computeEndMinutes(1320, 120)).toBe(1440);
  });
  it('施術が最低時間未満なら minDuration を適用', () => {
    expect(computeEndMinutes(600, 0)).toBe(630);
    expect(computeEndMinutes(600, 10)).toBe(630);
    expect(computeEndMinutes(600, 0, 60)).toBe(660);
  });
});

describe('endExceedsClose', () => {
  it('営業終了(closeHour)を超えるか判定', () => {
    expect(endExceedsClose(1320, 22)).toBe(false); // ちょうど 22:00
    expect(endExceedsClose(1290, 22)).toBe(false); // 21:30
    expect(endExceedsClose(1350, 22)).toBe(true);  // 22:30
    expect(endExceedsClose(1440, 22)).toBe(true);  // 24:00（跨ぎ）
  });
});

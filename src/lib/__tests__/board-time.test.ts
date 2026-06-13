import {
  timeToMinutes,
  minutesToTime,
  snapToSlot,
  computeEndMinutes,
  endExceedsClose,
  assignLanes,
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

describe('assignLanes', () => {
  it('空配列は laneCount=1', () => {
    expect(assignLanes([])).toEqual({ lanes: [], laneCount: 1 });
  });
  it('重複なしは全て同一レーン(0)', () => {
    const r = assignLanes([{ start: 0, end: 30 }, { start: 30, end: 60 }, { start: 60, end: 90 }]);
    expect(r).toEqual({ lanes: [0, 0, 0], laneCount: 1 });
  });
  it('完全重複の2件は別レーン', () => {
    const r = assignLanes([{ start: 0, end: 60 }, { start: 0, end: 60 }]);
    expect(r.laneCount).toBe(2);
    expect(new Set(r.lanes).size).toBe(2);
  });
  it('入力順を保った lanes を返す（後勝ちで隠れない）', () => {
    // 10:00-11:00 と 10:30-11:30 が重複 → 2レーン。3件目 11:30-12:00 は1件目のレーンを再利用
    const r = assignLanes([
      { start: 600, end: 660 },  // i0
      { start: 630, end: 690 },  // i1（i0と重複）
      { start: 690, end: 720 },  // i2（i0終了後）
    ]);
    expect(r.laneCount).toBe(2);
    expect(r.lanes[0]).not.toBe(r.lanes[1]); // 重複ペアは別レーン
    expect(r.lanes[2]).toBe(r.lanes[0]);     // 空いたレーンを再利用
  });
  it('3件同時重複は3レーン', () => {
    const r = assignLanes([{ start: 0, end: 90 }, { start: 30, end: 120 }, { start: 60, end: 150 }]);
    expect(r.laneCount).toBe(3);
  });
});

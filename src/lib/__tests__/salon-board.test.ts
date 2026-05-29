import {
  SALON_OPEN_HOUR,
  SALON_CLOSE_HOUR,
  SLOT_MINUTES,
  timeToMinutes,
  minutesToTime,
  addMinutes,
  computeEndTime,
  hoursRange,
  blockPosition,
  rangesOverlap,
  layoutRow,
  offsetToTime,
  nowLinePosition,
  formatDateLabel,
  shiftDate,
} from '@/lib/salon-board';

describe('salon-board pure functions', () => {
  describe('constants', () => {
    it('営業時間定数', () => {
      expect(SALON_OPEN_HOUR).toBe(9);
      expect(SALON_CLOSE_HOUR).toBe(22);
      expect(SLOT_MINUTES).toBe(15);
    });
  });

  describe('timeToMinutes', () => {
    it('HH:MM を分に変換', () => {
      expect(timeToMinutes('09:00')).toBe(540);
      expect(timeToMinutes('10:30')).toBe(630);
    });
    it('HH:MM:SS も解釈', () => {
      expect(timeToMinutes('14:15:00')).toBe(855);
    });
    it('不正値は NaN', () => {
      expect(timeToMinutes('abc')).toBeNaN();
      expect(timeToMinutes('12:zz')).toBeNaN();
      expect(timeToMinutes('')).toBeNaN();
    });
  });

  describe('minutesToTime', () => {
    it('分を HH:MM に変換', () => {
      expect(minutesToTime(540)).toBe('09:00');
      expect(minutesToTime(630)).toBe('10:30');
      expect(minutesToTime(0)).toBe('00:00');
    });
    it('負値は 0 に丸める', () => {
      expect(minutesToTime(-30)).toBe('00:00');
    });
    it('小数は四捨五入', () => {
      expect(minutesToTime(540.4)).toBe('09:00');
      expect(minutesToTime(540.6)).toBe('09:01');
    });
  });

  describe('addMinutes / computeEndTime', () => {
    it('加算', () => {
      expect(addMinutes('09:00', 30)).toBe('09:30');
      expect(addMinutes('09:45', 30)).toBe('10:15');
    });
    it('減算', () => {
      expect(addMinutes('09:30', -30)).toBe('09:00');
    });
    it('computeEndTime は所要時間を加算', () => {
      expect(computeEndTime('10:00', 90)).toBe('11:30');
    });
  });

  describe('hoursRange', () => {
    it('デフォルトは 9〜21', () => {
      expect(hoursRange()).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    });
    it('カスタム範囲', () => {
      expect(hoursRange(10, 13)).toEqual([10, 11, 12]);
    });
    it('開始>=終了は空配列', () => {
      expect(hoursRange(13, 13)).toEqual([]);
      expect(hoursRange(14, 13)).toEqual([]);
    });
  });

  describe('blockPosition', () => {
    it('開店時刻は left=0', () => {
      const p = blockPosition('09:00', '10:00');
      expect(p.leftPct).toBeCloseTo(0);
      expect(p.widthPct).toBeCloseTo((60 / 780) * 100);
    });
    it('途中の予約', () => {
      const p = blockPosition('10:00', '11:30');
      expect(p.leftPct).toBeCloseTo((60 / 780) * 100);
      expect(p.widthPct).toBeCloseTo((90 / 780) * 100);
    });
    it('開店前にはみ出す予約は左端でクランプ', () => {
      const p = blockPosition('08:00', '09:30');
      expect(p.leftPct).toBeCloseTo(0);
      expect(p.widthPct).toBeCloseTo((30 / 780) * 100);
    });
    it('閉店後にはみ出す予約は右端でクランプ', () => {
      const p = blockPosition('21:30', '23:00');
      expect(p.leftPct).toBeCloseTo((750 / 780) * 100);
      expect(p.widthPct).toBeCloseTo((30 / 780) * 100);
    });
    it('完全に営業時間外（前）は幅0', () => {
      const p = blockPosition('06:00', '07:00');
      expect(p.widthPct).toBe(0);
    });
    it('完全に営業時間外（後）は幅0', () => {
      const p = blockPosition('23:00', '23:30');
      expect(p.widthPct).toBe(0);
    });
  });

  describe('rangesOverlap', () => {
    it('重なる', () => {
      expect(rangesOverlap(0, 60, 30, 90)).toBe(true);
    });
    it('端点接触は非重複', () => {
      expect(rangesOverlap(0, 60, 60, 120)).toBe(false);
    });
    it('離れている', () => {
      expect(rangesOverlap(0, 30, 60, 90)).toBe(false);
    });
  });

  describe('layoutRow', () => {
    it('空配列', () => {
      expect(layoutRow([])).toEqual([]);
    });
    it('重ならない予約は laneCount=1', () => {
      const r = layoutRow([
        { id: 'a', start_time: '09:00', end_time: '10:00' },
        { id: 'b', start_time: '10:00', end_time: '11:00' },
      ] as { id: string; start_time: string; end_time: string }[]);
      expect(r.every((x) => x.laneCount === 1 && x.lane === 0)).toBe(true);
    });
    it('重なる2件は2レーン', () => {
      const r = layoutRow([
        { id: 'a', start_time: '09:00', end_time: '10:30' },
        { id: 'b', start_time: '10:00', end_time: '11:00' },
      ] as { id: string; start_time: string; end_time: string }[]);
      expect(r.find((x) => (x.item as { id: string }).id === 'a')!.lane).toBe(0);
      expect(r.find((x) => (x.item as { id: string }).id === 'b')!.lane).toBe(1);
      expect(r.every((x) => x.laneCount === 2)).toBe(true);
    });
    it('3件のうち2件だけ重なる場合、クラスタごとに laneCount が分かれる', () => {
      const r = layoutRow([
        { id: 'a', start_time: '09:00', end_time: '10:30' },
        { id: 'b', start_time: '10:00', end_time: '11:00' },
        { id: 'c', start_time: '12:00', end_time: '13:00' },
      ] as { id: string; start_time: string; end_time: string }[]);
      const c = r.find((x) => (x.item as { id: string }).id === 'c')!;
      expect(c.laneCount).toBe(1);
      const a = r.find((x) => (x.item as { id: string }).id === 'a')!;
      expect(a.laneCount).toBe(2);
    });
    it('同一開始時刻は終了時刻順', () => {
      const r = layoutRow([
        { id: 'long', start_time: '09:00', end_time: '11:00' },
        { id: 'short', start_time: '09:00', end_time: '10:00' },
      ] as { id: string; start_time: string; end_time: string }[]);
      // short が先（lane 0）、long が後（lane 1）
      expect(r.find((x) => (x.item as { id: string }).id === 'short')!.lane).toBe(0);
      expect(r.find((x) => (x.item as { id: string }).id === 'long')!.lane).toBe(1);
    });
    it('空いたレーンを再利用する', () => {
      const r = layoutRow([
        { id: 'a', start_time: '09:00', end_time: '10:00' },
        { id: 'b', start_time: '09:30', end_time: '11:00' },
        { id: 'c', start_time: '10:00', end_time: '10:30' },
      ] as { id: string; start_time: string; end_time: string }[]);
      // c は a が終わった lane 0 を再利用
      expect(r.find((x) => (x.item as { id: string }).id === 'c')!.lane).toBe(0);
    });
  });

  describe('offsetToTime', () => {
    it('左端は開店時刻', () => {
      expect(offsetToTime(0, 780)).toBe('09:00');
    });
    it('中央付近を刻みに丸める', () => {
      // 390/780 = 0.5 → 9*60 + 390 = 930分 = 15:30
      expect(offsetToTime(390, 780)).toBe('15:30');
    });
    it('幅0は開店時刻', () => {
      expect(offsetToTime(100, 0)).toBe('09:00');
    });
    it('右端は閉店1刻み前で上限', () => {
      expect(offsetToTime(780, 780)).toBe('21:45');
    });
    it('範囲外（左）は0にクランプ', () => {
      expect(offsetToTime(-50, 780)).toBe('09:00');
    });
    it('範囲外（右）は1にクランプ', () => {
      expect(offsetToTime(2000, 780)).toBe('21:45');
    });
  });

  describe('nowLinePosition', () => {
    it('営業時間内は%を返す', () => {
      expect(nowLinePosition(9 * 60)).toBeCloseTo(0);
      expect(nowLinePosition(22 * 60)).toBeCloseTo(100);
      expect(nowLinePosition(15 * 60)).toBeCloseTo((360 / 780) * 100);
    });
    it('開店前は null', () => {
      expect(nowLinePosition(8 * 60)).toBeNull();
    });
    it('閉店後は null', () => {
      expect(nowLinePosition(22 * 60 + 1)).toBeNull();
    });
  });

  describe('formatDateLabel', () => {
    it('曜日付きで整形', () => {
      expect(formatDateLabel('2026-05-29')).toBe('2026年5月29日（金）');
      expect(formatDateLabel('2026-05-31')).toBe('2026年5月31日（日）');
    });
    it('不正形式は元文字列', () => {
      expect(formatDateLabel('2026/05/29')).toBe('2026/05/29');
      expect(formatDateLabel('invalid')).toBe('invalid');
    });
  });

  describe('shiftDate', () => {
    it('翌日', () => {
      expect(shiftDate('2026-05-29', 1)).toBe('2026-05-30');
    });
    it('前日', () => {
      expect(shiftDate('2026-05-01', -1)).toBe('2026-04-30');
    });
    it('月跨ぎ', () => {
      expect(shiftDate('2026-05-31', 1)).toBe('2026-06-01');
    });
    it('年跨ぎ', () => {
      expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    });
  });
});

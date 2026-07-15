import { computeCancelFee, hoursUntilBookingStart, describeCancelPolicy } from '@/lib/cancel-fee';

describe('hoursUntilBookingStart', () => {
  it('JST の予約開始と now の差を時間で返す', () => {
    // 2026-04-01 10:00 JST = 2026-04-01 01:00 UTC
    const startUtcMs = Date.UTC(2026, 3, 1, 1, 0, 0);
    const nowMs = startUtcMs - 5 * 3_600_000; // 5時間前
    expect(hoursUntilBookingStart('2026-04-01', '10:00:00', nowMs)).toBeCloseTo(5, 5);
  });

  it('HH:MM 形式（秒なし）も解釈する', () => {
    const startUtcMs = Date.UTC(2026, 3, 1, 1, 0, 0);
    expect(hoursUntilBookingStart('2026-04-01', '10:00', startUtcMs)).toBeCloseTo(0, 5);
  });

  it('解釈不能な日付 → Infinity（無料扱い）', () => {
    expect(hoursUntilBookingStart('not-a-date', '10:00', Date.UTC(2026, 3, 1))).toBe(Infinity);
  });
});

describe('computeCancelFee', () => {
  const policy = { free_cancel_hours: 24, late_cancel_rate: 50, no_show_rate: 100 };

  it('policy 不在 → 無料', () => {
    expect(computeCancelFee(null, 5000, 1)).toEqual({ fee: 0, rate: 0, isLate: false });
  });

  it('金額不明/0以下 → 無料', () => {
    expect(computeCancelFee(policy, null, 1)).toEqual({ fee: 0, rate: 0, isLate: false });
    expect(computeCancelFee(policy, 0, 1)).toEqual({ fee: 0, rate: 0, isLate: false });
  });

  it('無料期限内（残り時間 >= free_cancel_hours）→ 無料', () => {
    expect(computeCancelFee(policy, 5000, 24)).toEqual({ fee: 0, rate: 50, isLate: false });
    expect(computeCancelFee(policy, 5000, 48)).toEqual({ fee: 0, rate: 50, isLate: false });
  });

  it('期限超過 → total_price × late_cancel_rate%（四捨五入）', () => {
    expect(computeCancelFee(policy, 5000, 1)).toEqual({ fee: 2500, rate: 50, isLate: true });
    expect(computeCancelFee({ free_cancel_hours: 24, late_cancel_rate: 30 }, 3333, 0)).toEqual({ fee: 1000, rate: 30, isLate: true });
  });

  it('料率0以下 → 無料（期限超過でも）', () => {
    expect(computeCancelFee({ free_cancel_hours: 24, late_cancel_rate: 0 }, 5000, 1)).toEqual({ fee: 0, rate: 0, isLate: false });
  });

  it('列が null → 既定0で扱い無料', () => {
    expect(computeCancelFee({ free_cancel_hours: null, late_cancel_rate: null }, 5000, -1)).toEqual({ fee: 0, rate: 0, isLate: false });
  });
});

describe('describeCancelPolicy（2026年7月15日 追加・予約確認画面の表示文言生成）', () => {
  it('無料期限あり・料率ありの通常ケース', () => {
    expect(describeCancelPolicy({ free_cancel_hours: 24, late_cancel_rate: 50 })).toBe(
      '予約日時の24時間前まで無料でキャンセルできます。それ以降のキャンセルは施術料金の50%をキャンセル料として承ります。'
    );
  });

  it('late_cancel_rate <= 0 → キャンセル料なしの文言（free_cancel_hoursの値に関わらず優先）', () => {
    expect(describeCancelPolicy({ free_cancel_hours: 24, late_cancel_rate: 0 })).toBe('予約後のキャンセル料はかかりません。');
    expect(describeCancelPolicy({ free_cancel_hours: 24, late_cancel_rate: null })).toBe('予約後のキャンセル料はかかりません。');
  });

  it('free_cancel_hours <= 0（キャンセル不可設定）・rate > 0 → 無料期限なしの文言', () => {
    expect(describeCancelPolicy({ free_cancel_hours: 0, late_cancel_rate: 100 })).toBe(
      'キャンセルの場合、施術料金の100%をキャンセル料として承ります。'
    );
  });

  it('列が null → 既定0扱い（free=0, rate=0 でキャンセル料なし文言が優先される）', () => {
    expect(describeCancelPolicy({ free_cancel_hours: null, late_cancel_rate: null })).toBe('予約後のキャンセル料はかかりません。');
  });
});

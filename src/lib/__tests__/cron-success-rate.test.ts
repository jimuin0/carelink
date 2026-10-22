import { cronHealthyRate, cronHealthyRateAccent } from '../cron-success-rate';

describe('cronHealthyRate', () => {
  test('skipped だけの 30 日間は 100%（処理対象 0 件は正常終了）', () => {
    // 回帰: 旧実装は successes / total で、skipped を失敗側に数えて 0% の赤になっていた。
    expect(cronHealthyRate({ total: 4300, successes: 0, skipped: 4300 })).toBe(100);
  });

  test('本番の実態に近い内訳（skipped が多数派）でも、エラーが無ければ 100%', () => {
    expect(cronHealthyRate({ total: 7400, successes: 3100, skipped: 4300 })).toBe(100);
  });

  test('エラーが混じると下がる', () => {
    expect(cronHealthyRate({ total: 100, successes: 60, skipped: 20 })).toBe(80);
  });

  test('エラーが 1 件でもあれば 100% と表示しない（切り捨て）', () => {
    expect(cronHealthyRate({ total: 7400, successes: 3099, skipped: 4300 })).toBe(99);
  });

  test('記録が無いときは null（0% の赤にしない）', () => {
    expect(cronHealthyRate({ total: 0, successes: 0, skipped: 0 })).toBeNull();
  });

  test('件数の取得タイミングがずれて正常件数が総数を超えても 100% を上限にする', () => {
    expect(cronHealthyRate({ total: 10, successes: 8, skipped: 3 })).toBe(100);
  });
});

describe('cronHealthyRateAccent', () => {
  test.each([
    [null, 'gray'],
    [100, 'emerald'],
    [95, 'emerald'],
    [94, 'amber'],
    [80, 'amber'],
    [79, 'rose'],
    [0, 'rose'],
  ] as const)('%p → %s', (rate, accent) => {
    expect(cronHealthyRateAccent(rate)).toBe(accent);
  });
});

/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 利用状況分析の集計（computeUsageStats）を JST の暦月境界で固定する（2026年10月22日 新設）。
 *
 * 回帰の中身: 以前の page.tsx は「今月」の起点に jstMonthStartIso(-1)（＝前月 1 日）を使っており、
 * 10/22 に開くと「MAU（月間）」と「今月の予約ステータス」に 9 月分がまるごと混ざり、
 * 「前月比」は約 52 日分と 8 月 1 か月分を比べていた。
 */
import { computeUsageStats, type UsageBooking } from '../usage-stats';

afterEach(() => {
  jest.useRealTimers();
});

function at(iso: string) {
  jest.useFakeTimers({ now: new Date(iso) });
}

const b = (user_id: string | null, created_at: string | null, status = 'completed'): UsageBooking => ({ user_id, created_at, status });

describe('2026-10-22 12:00（JST）に開いたとき', () => {
  // 境界（UTC）: 今日=10/21 15:00Z / 7日前=10/14 15:00Z / 今月=9/30 15:00Z / 前月=8/31 15:00Z
  // 前月同期の終わり＝9/22 12:00 JST（9/22 03:00Z）
  const bookings: UsageBooking[] = [
    b('u1', '2026-09-10T01:00:00+00:00'), // 9月（前月同期の中）
    b('u2', '2026-09-25T01:00:00+00:00'), // 9月（前月同期より後）
    b('u3', '2026-10-05T01:00:00.123456+00:00', 'confirmed'),
    b('u1', '2026-10-10T01:00:00+00:00'),
    b('u4', '2026-09-30T15:00:00+00:00', 'cancelled'), // ちょうど 10/1 0:00 JST＝今月
    b('u5', '2026-09-30T14:59:59.999+00:00'), // 9/30 23:59:59 JST＝前月
    b('u6', '2026-08-15T00:00:00+00:00'), // 8月
    b(null, '2026-10-21T15:30:00+00:00', 'confirmed'), // 今日のゲスト予約（人数には数えない）
    b('u7', null), // 作成日時なし＝どの期間にも入れない
    b('u8', 'not-a-date'), // 解釈できない＝どの期間にも入れない
    b('u3', '2026-10-21T16:00:00+00:00'), // 今日
    b('u2', '2026-10-14T15:00:00+00:00', 'confirmed'), // ちょうど 7 日前の 0:00 JST
  ];

  test('MAU は今月 1 日（JST）からの利用者だけを数える（9月分を混ぜない）', () => {
    at('2026-10-22T03:00:00Z');
    const stats = computeUsageStats(bookings);
    expect(stats.mau).toBe(4); // u1・u2・u3・u4（9月だけの u5・u6 は入らない）
  });

  test('カードの MAU と月別グラフの当月の値が一致する', () => {
    at('2026-10-22T03:00:00Z');
    const stats = computeUsageStats(bookings);
    expect(stats.monthly[stats.monthly.length - 1]).toEqual({ month: '10月', mau: stats.mau, bookings: 6 });
  });

  test('前月比は前月の同じ経過期間（9/1〜9/22 12:00）と比べる', () => {
    at('2026-10-22T03:00:00Z');
    const stats = computeUsageStats(bookings);
    expect(stats.prevMauSamePeriod).toBe(1); // u1 だけ（9/25 の u2・9/30 の u5 は同期間の外）
    expect(stats.mauGrowth).toBe(300);
  });

  test('今月の予約ステータスは今月作られた予約だけ（ゲスト予約も件数には入る）', () => {
    at('2026-10-22T03:00:00Z');
    expect(computeUsageStats(bookings).statusCount).toEqual({ confirmed: 3, completed: 2, cancelled: 1 });
  });

  test('DAU・WAU は JST の今日・7 日前の 0:00 から', () => {
    at('2026-10-22T03:00:00Z');
    const stats = computeUsageStats(bookings);
    expect(stats.dau).toBe(1); // u3（ゲストは数えない）
    expect(stats.wau).toBe(2); // u3・u2（7 日前ちょうどを含む）
  });

  test('月別は直近 6 か月を古い順に、それぞれの暦月で数える', () => {
    at('2026-10-22T03:00:00Z');
    expect(computeUsageStats(bookings).monthly).toEqual([
      { month: '5月', mau: 0, bookings: 0 },
      { month: '6月', mau: 0, bookings: 0 },
      { month: '7月', mau: 0, bookings: 0 },
      { month: '8月', mau: 1, bookings: 1 },
      { month: '9月', mau: 3, bookings: 3 },
      { month: '10月', mau: 4, bookings: 6 },
    ]);
  });

  test('リピート率は識別できる利用者だけで数える', () => {
    at('2026-10-22T03:00:00Z');
    const stats = computeUsageStats(bookings);
    expect([stats.repeatUsers, stats.totalUsers, stats.repeatRate]).toEqual([3, 6, 50]);
  });
});

test('前月に同じ日付が無い月末は、前月まるごとと比べる（3/31 に 2 月と比べる）', () => {
  at('2026-03-31T03:00:00Z');
  const stats = computeUsageStats([
    b('feb-last', '2026-02-28T14:00:00+00:00'), // 2/28 23:00 JST
    b('mar-first', '2026-02-28T16:00:00+00:00'), // 3/1 01:00 JST
  ]);
  expect([stats.mau, stats.prevMauSamePeriod, stats.mauGrowth]).toEqual([1, 1, 0]);
});

test('UTC ではまだ前月の時間帯（JST の月初 0〜9 時）でも、JST の今月で数える', () => {
  at('2026-10-31T16:00:00Z'); // 11/1 01:00 JST
  const stats = computeUsageStats([
    b('nov', '2026-10-31T15:30:00+00:00'), // 11/1 00:30 JST
    b('oct', '2026-10-31T14:00:00+00:00'), // 10/31 23:00 JST
    b('oct-first-hour', '2026-09-30T15:30:00+00:00'), // 10/1 00:30 JST＝前月同期（最初の 1 時間）
  ]);
  expect(stats.mau).toBe(1);
  expect(stats.prevMauSamePeriod).toBe(1);
  expect(stats.statusCount).toEqual({ completed: 1 });
  expect(stats.monthly.map((m) => m.month).slice(-2)).toEqual(['10月', '11月']);
});

test('前月同期に利用者がいなければ前月比は出さない（0 で割らない）', () => {
  at('2026-10-22T03:00:00Z');
  const stats = computeUsageStats([b('u1', '2026-10-05T00:00:00+00:00')]);
  expect(stats.mauGrowth).toBeNull();
});

test('予約が無ければ全て 0', () => {
  at('2026-10-22T03:00:00Z');
  const stats = computeUsageStats([]);
  expect(stats).toMatchObject({ dau: 0, wau: 0, mau: 0, prevMauSamePeriod: 0, mauGrowth: null, repeatUsers: 0, totalUsers: 0, repeatRate: 0, statusCount: {} });
});

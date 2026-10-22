/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  SLOTS_WEEK_MAX_DATES, SLOTS_WEEK_MAX_STAFF, chunkStaffIds, fetchSlotsWeek, mergeSlotsInStaffOrder,
} from '../slots-week';

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);

test('上限はサーバーの検証と同じ（スタッフ10人・7日）', () => {
  expect(SLOTS_WEEK_MAX_STAFF).toBe(10);
  expect(SLOTS_WEEK_MAX_DATES).toBe(7);
});

test('スタッフは順序を保ったまま上限ごとに分ける', () => {
  expect(chunkStaffIds(ids(12))).toEqual([ids(10), ['s11', 's12']]);
  expect(chunkStaffIds(ids(3), 2)).toEqual([['s1', 's2'], ['s3']]);
  expect(chunkStaffIds([])).toEqual([]);
});

test('グループごとに取得して日付・スタッフ別にまとめる', async () => {
  fetchMock.mockImplementation((url: string) => {
    const staff = new URL(url, 'http://x').searchParams.get('staffIds')!.split(',');
    return Promise.resolve(ok({ days: { '2026-11-01': Object.fromEntries(staff.map((s) => [s, [{ slot_start: '10:00:00', slot_end: '11:00:00' }]])) } }));
  });
  const result = await fetchSlotsWeek({ facilityId: 'f1', staffIds: ids(12), dates: ['2026-11-01'], duration: 90 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const first = new URL(fetchMock.mock.calls[0][0], 'http://x');
  expect(first.pathname).toBe('/api/slots/week');
  expect(first.searchParams.get('facilityId')).toBe('f1');
  expect(first.searchParams.get('dates')).toBe('2026-11-01');
  expect(first.searchParams.get('duration')).toBe('90');
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  expect(Object.keys(result.days['2026-11-01'])).toEqual(ids(12));
  expect(result.bookingAvailable).toBe(true);
});

// 予約日時の変更画面だけが、変更する予約を「埋まっている枠」に数えないよう渡す（2026年10月23日）。
test('excludeBookingId を渡したときだけ、全グループのリクエストに付ける', async () => {
  fetchMock.mockResolvedValue(ok({ days: {} }));
  await fetchSlotsWeek({ facilityId: 'f1', staffIds: ids(12), dates: ['2026-11-01'], duration: 60, excludeBookingId: 'b1' });
  expect(fetchMock.mock.calls.map((c) => new URL(c[0], 'http://x').searchParams.get('excludeBookingId'))).toEqual(['b1', 'b1']);
  fetchMock.mockClear();
  await fetchSlotsWeek({ facilityId: 'f1', staffIds: ['a'], dates: ['2026-11-01'], duration: 60 });
  expect(new URL(fetchMock.mock.calls[0][0], 'http://x').searchParams.has('excludeBookingId')).toBe(false);
});

test('店舗のネット予約が準備中なら bookingAvailable=false を返す', async () => {
  fetchMock.mockResolvedValue(ok({ days: {}, bookingAvailable: false }));
  await expect(fetchSlotsWeek({ facilityId: 'f1', staffIds: ['a'], dates: ['2026-11-01'], duration: 60 }))
    .resolves.toEqual({ ok: true, days: {}, bookingAvailable: false });
});

test.each([
  ['HTTP エラー（429）', { ok: false, status: 429, json: () => Promise.resolve({ days: {} }) }],
  ['JSON でない応答', { ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) }],
  ['days が無い', ok({})],
  ['days が null', ok({ days: null })],
])('1グループでも失敗（%s）なら全体を失敗にする（一部の結果を満席に見せない）', async (_label, failing) => {
  fetchMock
    .mockResolvedValueOnce(ok({ days: { '2026-11-01': { s1: [] } } }))
    .mockResolvedValueOnce(failing);
  await expect(fetchSlotsWeek({ facilityId: 'f1', staffIds: ids(11), dates: ['2026-11-01'], duration: 60 }))
    .resolves.toEqual({ ok: false });
});

test('中断は失敗ではないので例外のまま返す', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  fetchMock.mockRejectedValue(abort);
  await expect(fetchSlotsWeek({ facilityId: 'f1', staffIds: ['a'], dates: ['2026-11-01'], duration: 60 })).rejects.toBe(abort);
});

test('同じ開始時刻はスタッフの並び順で先の人の枠を採り、開始時刻順に並べる', () => {
  const merged = mergeSlotsInStaffOrder(['b', 'a', 'c'], {
    a: [{ slot_start: '09:00:00', slot_end: '10:00:00' }, { slot_start: '10:00:00', slot_end: '11:00:00' }],
    b: [{ slot_start: '10:00:00', slot_end: '11:00:00' }],
  });
  expect(merged).toEqual([
    { slot_start: '09:00:00', slot_end: '10:00:00', staff_id: 'a' },
    { slot_start: '10:00:00', slot_end: '11:00:00', staff_id: 'b' },
  ]);
});

test('その日の結果が無ければ空', () => {
  expect(mergeSlotsInStaffOrder(['a'], undefined)).toEqual([]);
});

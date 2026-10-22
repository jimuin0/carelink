/** @jest-environment node */
/**
 * 利用状況分析（/admin/usage-stats）の「MAU（月間）」「前月比」「今月の予約ステータス」が、
 * JST の今月だけを数えること（2026年10月22日）。
 *
 * 以前は「今月」の起点が前月 1 日だったため、10/22 に開くと 9 月分が混ざり、前月比は
 * 約 52 日分と 8 月 1 か月分を比べていた。集計そのものは src/lib/__tests__/usage-stats.test.ts が
 * 細かく固定し、ここでは画面に出る数字と全件読み取り（ページング）の配線を確かめる。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import UsageStatsPage from '../usage-stats/page';

const FACILITY = 'ab140000-0000-4000-8000-000000000001';
const mockFrom = jest.fn();
const bookingQueries: Record<string, jest.Mock>[] = [];
let mockBookings: unknown[] = [];

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-owner' } }, error: null }) },
    from: mockFrom,
  }),
}));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockFrom }) }));
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));

function query(table: string) {
  const data = table === 'facility_members' ? [{ facility_id: FACILITY }] : table === 'bookings' ? mockBookings : [];
  const q: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'range']) q[method] = jest.fn(() => q);
  q.maybeSingle = jest.fn(() => Promise.resolve({ data: data[0] ?? null, error: null }));
  q.then = jest.fn((resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve, reject));
  if (table === 'bookings') bookingQueries.push(q);
  return q;
}

/** タグとコメントを外した表示テキスト */
async function renderText() {
  const html = renderToStaticMarkup(await UsageStatsPage());
  return html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '');
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-22T03:00:00Z') }); // 10/22 12:00 JST
  mockFrom.mockReset().mockImplementation(query);
  bookingQueries.length = 0;
  mockBookings = [
    { user_id: 'u1', created_at: '2026-09-10T01:00:00+00:00', status: 'completed' }, // 9月・前月同期の中
    { user_id: 'u2', created_at: '2026-09-25T01:00:00+00:00', status: 'completed' }, // 9月・前月同期の外
    { user_id: 'u3', created_at: '2026-10-05T01:00:00+00:00', status: 'confirmed' },
    { user_id: 'u4', created_at: '2026-10-10T01:00:00+00:00', status: 'completed' },
    { user_id: 'u5', created_at: '2026-08-15T01:00:00+00:00', status: 'completed' }, // 8月
  ];
});

afterEach(() => {
  jest.useRealTimers();
});

test('MAU（月間）は今月の利用者だけで、前月の同じ期間と比べる', async () => {
  const text = await renderText();
  expect(text).toContain('MAU（月間）2人前月同期比 +100%');
});

test('今月の予約ステータスに先月の予約を混ぜない', async () => {
  const text = await renderText();
  expect(text).toContain('今月の予約ステータス確定1件完了1件');
});

test('カードの MAU と月別グラフの当月（10月）が一致する', async () => {
  const html = renderToStaticMarkup(await UsageStatsPage()).replace(/<!-- -->/g, '');
  // 月別グラフの 10 月の行だけを切り出す（月ラベル → 棒の中の人数 → 件数）
  const start = html.indexOf('w-8 shrink-0">10月</span>');
  expect(start).toBeGreaterThan(-1);
  const row = html.slice(start, html.indexOf('件</span>', start) + '件</span>'.length);
  const barMau = row.match(/text-white font-bold">(\d+)<\/span>/)?.[1];
  const cardMau = html.replace(/<[^>]+>/g, '').match(/MAU（月間）(\d+)人/)?.[1];
  expect(barMau).toBe('2');
  expect(cardMau).toBe(barMau);
  expect(row.match(/>(\d+)件<\/span>$/)?.[1]).toBe('2'); // 予約件数
});

test('直近 12 か月の予約を並び順つきでページングして全件読む', async () => {
  await renderText();
  const q = bookingQueries[0];
  expect(q.gte).toHaveBeenCalledWith('created_at', '2025-09-30T15:00:00.000Z'); // 12 か月前の 1 日 0:00 JST
  expect(q.order).toHaveBeenCalledWith('created_at', { ascending: true });
  expect(q.order).toHaveBeenCalledWith('id', { ascending: true });
  expect(q.range).toHaveBeenCalledWith(0, 999);
});

test('注記は管理画面の地色（gray-100）の上でも AA（4.5:1）を満たす色で出す', async () => {
  const html = renderToStaticMarkup(await UsageStatsPage());
  // 注記は白いカードの外＝レイアウトの bg-gray-100 の上にある。gray-500 は 4.39:1、sky-600 は 3.72:1 で届かない。
  const note = html.match(/<div class="([^"]*)">※ MAU\/DAU/)?.[1];
  expect(note?.split(' ')).toContain('text-gray-600');
  const link = html.match(/<a class="([^"]*)" href="\/admin\/analytics">/)?.[1];
  expect(link?.split(' ')).toContain('text-sky-700');
});

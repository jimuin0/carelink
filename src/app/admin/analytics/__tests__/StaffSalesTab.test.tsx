/**
 * @jest-environment jsdom
 *
 * 監査 A171: 今月の起点をブラウザのローカル時刻で作り、上限日も付けず、1000 行を超えた分を読んでいなかった。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import StaffSalesTab from '../StaffSalesTab';

const calls: unknown[][] = [];
let pages: { staff_id: string; total_price: number }[][] = [];
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      let page = 0;
      for (const m of ['select', 'eq', 'gte', 'lt', 'order']) chain[m] = (...a: unknown[]) => { if (table === 'bookings') calls.push([m, ...a]); return chain; };
      chain.range = (from: number) => { page = from / 1000; calls.push(['range', from]); return chain; };
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(
        table === 'bookings' ? { data: pages[page] ?? [], error: null } : { data: [{ id: 's1', name: '合成スタッフ' }], error: null },
      ).then(resolve);
      return chain;
    },
  }),
}));

beforeEach(() => { calls.length = 0; });
afterEach(() => { jest.useRealTimers(); });

test('JST の今月（翌月1日未満）で絞り、1000 行を超える分もページングして合計する', async () => {
  // UTC 2026-10-31 16:00 = JST 2026-11-01 01:00（ブラウザが UTC 等だと 10 月扱いになっていた）
  jest.useFakeTimers({ now: new Date('2026-10-31T16:00:00Z'), doNotFake: ['setTimeout', 'queueMicrotask', 'nextTick', 'setImmediate'] });
  pages = [Array.from({ length: 1000 }, () => ({ staff_id: 's1', total_price: 1 })), [{ staff_id: 's1', total_price: 5 }]];
  render(<StaffSalesTab facilityId="f1" />);
  expect(await screen.findByText('¥1,005')).toBeInTheDocument();
  expect(screen.getByText('1001件')).toBeInTheDocument();
  expect(calls).toContainEqual(['gte', 'booking_date', '2026-11-01']);
  expect(calls).toContainEqual(['lt', 'booking_date', '2026-12-01']);
  expect(calls).toContainEqual(['range', 1000]);
});

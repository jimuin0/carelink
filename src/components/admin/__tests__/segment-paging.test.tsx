/**
 * 監査 A97/A98: customer_segments を範囲指定なしで読むと max-rows（1000行）で黙って切れ、
 * 円グラフの内訳・総顧客数とリピート率が実際と食い違っていた。
 */
import { render, screen } from '@testing-library/react';
import CustomerSegmentChart from '../CustomerSegmentChart';
import RepeatRateCard from '../RepeatRateCard';

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null, Cell: () => null, Tooltip: () => null, Legend: () => null,
}));

let rows: { segment: string }[] = [];
let counts: { all: number | null; repeat: number | null; error?: unknown } = { all: 0, repeat: 0 };
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    from: () => {
      let range: [number, number] | null = null; let gte = false; let head = false;
      const q: Record<string, unknown> = {};
      q.select = (_c: string, o?: { head?: boolean }) => { head = !!o?.head; return q; };
      q.eq = () => q; q.order = () => q;
      q.gte = () => { gte = true; return q; };
      q.range = (a: number, b: number) => { range = [a, b]; return q; };
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(
        head ? { count: gte ? counts.repeat : counts.all, error: counts.error ?? null, data: null }
          : { data: range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000), error: null },
      ).then(resolve);
      return q;
    },
  }),
}));

test('顧客セグメントは1000行を超えても全件で数える', async () => {
  rows = Array.from({ length: 1500 }, (_, i) => ({ segment: i < 1200 ? 'regular' : 'new' }));
  render(<CustomerSegmentChart facilityId="f1" />);
  expect(await screen.findByText(/1,?500/)).toBeTruthy();
});

test('リピート率は件数で全顧客から計算する', async () => {
  counts = { all: 3000, repeat: 1500 };
  render(<RepeatRateCard facilityId="f1" />);
  expect(await screen.findByText('50%')).toBeTruthy();
});

test('リピート率の件数を取れなければ失敗を表示する', async () => {
  counts = { all: null, repeat: null, error: { message: 'db down' } };
  render(<RepeatRateCard facilityId="f1" />);
  expect(await screen.findByRole('alert')).toBeTruthy();
});

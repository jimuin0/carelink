/**
 * @jest-environment jsdom
 *
 * 監査 A387: 「過去30日」は今日を含む JST の30日分（今日-29日〜今日）で取得する。
 */
import { render, waitFor } from '@testing-library/react';
import BookingTrendChart from '../BookingTrendChart';

jest.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Pass, BarChart: Pass, Bar: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null, Legend: () => null };
});

const gteCalls: unknown[][] = [];
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q;
      q.gte = (...args: unknown[]) => { gteCalls.push(args); return q; };
      q.order = () => Promise.resolve({ data: [], error: null });
      return q;
    },
  }),
}));

afterEach(() => { jest.useRealTimers(); gteCalls.length = 0; });

test('JST 早朝でも開始日は JST の今日から29日前', async () => {
  jest.useFakeTimers({ now: new Date('2026-11-14T16:30:00Z') }); // JST 2026-11-15 01:30
  render(<BookingTrendChart facilityId="f1" />);
  await waitFor(() => expect(gteCalls).toHaveLength(1));
  expect(gteCalls[0]).toEqual(['date', '2026-10-17']);
});

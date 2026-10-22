/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import CronMonitorPage from '../page';

// 直近30日の件数（本番の実態に近い内訳: skipped が多数派・エラー 0）。
let counts: { total: number; success: number; error: number; skipped: number };

function query() {
  const filters: Record<string, unknown> = {};
  let head = false;
  const q: Record<string, unknown> = {
    select: (_cols: string, opts?: { head?: boolean }) => { head = !!opts?.head; return q; },
    gte: () => q,
    order: () => q,
    limit: () => q,
    eq: (col: string, value: unknown) => { filters[col] = value; return q; },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const status = filters.status as keyof typeof counts | undefined;
      const result = head
        ? { count: status ? counts[status] : counts.total, error: null }
        : { data: [], error: null };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return q;
}

jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({ from: () => query() }),
}));

beforeEach(() => {
  counts = { total: 7400, success: 3100, error: 0, skipped: 4300 };
});

test('skipped（処理対象0件＝正常）を成功側に数え、健全なら赤にしない', async () => {
  // 回帰: 旧実装は success / total（=41%）で常に赤（rose）だった。
  render(<CronMonitorPage />);
  const rate = await screen.findByText('100%');
  expect(rate.closest('div')).toHaveClass('border-t-emerald-500');
  expect(screen.queryByText('41%')).not.toBeInTheDocument();
  // 注記は管理画面の bg-gray-100 に直接載る。gray-500 は 4.39:1 で AA（4.5:1）に届かないので gray-600。
  const note = screen.getByText(/スキップ 4300件/);
  expect(note).toHaveClass('text-gray-600');
  expect(note).not.toHaveClass('text-gray-500');
});

test('エラーが混じると成功率が下がる', async () => {
  counts = { total: 100, success: 60, error: 20, skipped: 20 };
  render(<CronMonitorPage />);
  const rate = await screen.findByText('80%');
  expect(rate.closest('div')).toHaveClass('border-t-amber-500');
});

test('記録が無いときは「—」で表示し、0% の赤にしない', async () => {
  counts = { total: 0, success: 0, error: 0, skipped: 0 };
  render(<CronMonitorPage />);
  expect(await screen.findByText('—')).toBeInTheDocument();
  expect(screen.queryByText('0%')).not.toBeInTheDocument();
});

/**
 * @jest-environment jsdom
 *
 * 監査F13: 本日満枠時に「キャンセル待ち登録（近日公開）」表示を出す（登録UI自体は未実装）。
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import RemainingSlots from '@/components/facility/RemainingSlots';

function mockFetchWithSlots(slots: number | null) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      return { dates: { [today]: { slots } } };
    },
  }) as unknown as typeof fetch;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('残り0枠 → 「本日満枠」＋キャンセル待ち近日公開を表示', async () => {
  mockFetchWithSlots(0);
  render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(screen.getByText('本日満枠')).toBeInTheDocument());
  expect(screen.getByText(/キャンセル待ち登録：近日公開/)).toBeInTheDocument();
});

test('残り3枠 → 「本日残り3枠」のみ、キャンセル待ち表示なし', async () => {
  mockFetchWithSlots(3);
  render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(screen.getByText('本日残り3枠')).toBeInTheDocument());
  expect(screen.queryByText(/キャンセル待ち登録/)).not.toBeInTheDocument();
});

test('残り6枠以上 → 何も表示しない', async () => {
  mockFetchWithSlots(6);
  const { container } = render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test('fetch失敗 → 何も表示しない', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;
  const { container } = render(<RemainingSlots facilityId="f1" />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

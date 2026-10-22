/**
 * @jest-environment jsdom
 *
 * 掲載が下書き・停止に戻った施設のお気に入りを、マイページから外すボタン（2026年10月23日）。
 * 以前はこのカードに操作が無く、施設ページも 404 でハートも押せないため、外す手段が無かった。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import RemoveFavoriteButton from '@/components/mypage/RemoveFavoriteButton';

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

const FACILITY_ID = 'fa7f0001-0000-4000-8000-000000000002';
function mockFetch(response: { ok: boolean; status: number; body: unknown } | Error) {
  global.fetch = jest.fn(async () => {
    if (response instanceof Error) throw response;
    return { ok: response.ok, status: response.status, json: async () => response.body };
  }) as unknown as typeof fetch;
}

afterEach(() => jest.clearAllMocks());

test('「お気に入りから外す」は isFavorited:false を送り、外れたと確かめてから一覧を読み直す', async () => {
  mockFetch({ ok: true, status: 200, body: { isFavorited: false } });
  render(<RemoveFavoriteButton facilityId={FACILITY_ID} />);
  fireEvent.click(screen.getByRole('button', { name: 'お気に入りから外す' }));
  expect(await screen.findByRole('status')).toHaveTextContent('お気に入りから外しました。');
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe('/api/favorites');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ facilityId: FACILITY_ID, isFavorited: false });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test.each([
  ['API が断った（404）', { ok: false, status: 404, body: { error: '施設が見つかりません' } }],
  ['外れたと確かめられない応答', { ok: true, status: 200, body: { isFavorited: true } }],
  ['応答を読めない', { ok: true, status: 200, body: null }],
  ['通信の失敗', new Error('synthetic network failure')],
] as const)('%s → 成功と見せずにエラーを出し、もう一度押せる', async (_label, response) => {
  mockFetch(response as { ok: boolean; status: number; body: unknown } | Error);
  render(<RemoveFavoriteButton facilityId={FACILITY_ID} />);
  fireEvent.click(screen.getByRole('button', { name: 'お気に入りから外す' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('お気に入りから外せませんでした。');
  expect(screen.getByRole('button', { name: 'お気に入りから外す' })).toBeEnabled();
  expect(mockRefresh).not.toHaveBeenCalled();
});

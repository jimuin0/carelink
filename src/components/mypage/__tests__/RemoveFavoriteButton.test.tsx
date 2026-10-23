/**
 * @jest-environment jsdom
 *
 * 掲載が下書き・停止に戻った施設のお気に入りを、マイページから外すボタン（2026年10月23日）。
 * 以前はこのカードに操作が無く、施設ページも 404 でハートも押せないため、外す手段が無かった。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RemoveFavoriteButton from '@/components/mypage/RemoveFavoriteButton';
import { FavoriteRemovalStatusProvider } from '@/components/mypage/FavoriteRemovalStatus';

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

// 外すとボタンが消え、router.refresh() でカードごと一覧から消える。カードの中にお知らせを出すと
// フォーカスが body に戻り、お知らせもカードと一緒に消える（支援技術の利用者に成功が伝わらない）。
// ページ側の器があれば、お知らせはカードの外の常設ライブリージョンへ、フォーカスは見出しへ移す。
describe('ページ側の器（FavoriteRemovalStatusProvider）の中', () => {
  function Page({ showCard }: { showCard: boolean }) {
    return (
      <div>
        <h1 id="favorites-heading" tabIndex={-1}>お気に入り施設</h1>
        <FavoriteRemovalStatusProvider headingId="favorites-heading">
          {showCard ? <RemoveFavoriteButton facilityId={FACILITY_ID} /> : <p>お気に入りがありません</p>}
        </FavoriteRemovalStatusProvider>
      </div>
    );
  }

  test('お知らせは最初から在るカード外のライブリージョンに入り、フォーカスは見出しへ移り、カードが消えても残る', async () => {
    mockFetch({ ok: true, status: 200, body: { isFavorited: false } });
    const { rerender } = render(<Page showCard />);
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    const button = screen.getByRole('button', { name: 'お気に入りから外す' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(region).toHaveTextContent('お気に入りから外しました。'));
    expect(screen.getByRole('heading', { name: 'お気に入り施設' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'お気に入りから外す' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    // refresh で一覧が読み直され、カードが消えた（最後の 1 件なら空の状態に置き換わった）あとも残る。
    rerender(<Page showCard={false} />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('お気に入りから外しました。');
  });

  test('失敗したときはお知らせを出さず、フォーカスも動かさない', async () => {
    mockFetch({ ok: false, status: 404, body: null });
    render(<Page showCard />);
    const button = screen.getByRole('button', { name: 'お気に入りから外す' });
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('お気に入りから外せませんでした。');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(button).toHaveFocus();
  });
});

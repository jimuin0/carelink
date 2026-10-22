/**
 * スマホの絞り込みドロワーの検査（2026年10月22日）。
 *
 * 「この条件で検索」「クリア」を押しても、検索パラメータだけが変わる遷移ではページが作り直されず、
 * ドロワーが開いたまま結果が裏で切り替わっていた（押しても反応が無いように見える・本番で再現）。
 * 適用・クリアしたらドロワーを閉じる。デスクトップのサイドバー（onApplied 無し）は従来どおり。
 * ドロワーの中の「駅から探す」で駅を選んだときも同じく結果が切り替わるので閉じる
 * （駅選択のモーダルは本物を描き、/api/stations だけを差し替える）。
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import MobileFilterDrawer from '../MobileFilterDrawer';
import SearchFilters from '../SearchFilters';

const mockPush = jest.fn();
let mockParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockParams,
}));

// jsdom は <dialog> の showModal / close を実装していない
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

const originalFetch = global.fetch;
const originalTimeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');

beforeEach(() => {
  mockPush.mockReset();
  mockParams = new URLSearchParams();
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalTimeout) Object.defineProperty(AbortSignal, 'timeout', originalTimeout);
});

function openDrawer() {
  render(<MobileFilterDrawer />);
  const dialog = document.getElementById('mobile-filter-dialog') as HTMLDialogElement;
  dialog.showModal();
  expect(dialog).toHaveAttribute('open');
  return dialog;
}

test('「この条件で検索」で結果を切り替え、ドロワーを閉じる', () => {
  const dialog = openDrawer();
  fireEvent.click(screen.getByRole('button', { name: '当日予約OK' }));
  fireEvent.click(screen.getByRole('button', { name: 'この条件で検索' }));
  expect(mockPush).toHaveBeenCalledWith(`/search?features=${encodeURIComponent('当日予約OK')}`);
  expect(dialog).not.toHaveAttribute('open');
});

test('「クリア」でも（条件が無く同じ URL への遷移でも）ドロワーを閉じる', () => {
  mockParams = new URLSearchParams('keyword=整体');
  const dialog = openDrawer();
  fireEvent.click(screen.getByRole('button', { name: 'フィルターをクリア' }));
  expect(mockPush).toHaveBeenCalledWith(`/search?keyword=${encodeURIComponent('整体')}`);
  expect(dialog).not.toHaveAttribute('open');
});

test('ドロワーの「駅から探す」で駅を選んだら、その駅で検索してドロワーを閉じる', async () => {
  // jsdom は AbortSignal.timeout を持たない
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ stations: ['渋谷'] }) }) as unknown as typeof fetch;
  const dialog = openDrawer();
  fireEvent.click(within(dialog).getByRole('button', { name: '駅から探す' }));
  const station = await screen.findByRole('option', { name: '渋谷' });
  expect(global.fetch).toHaveBeenCalledWith('/api/stations', expect.anything());
  fireEvent.click(station);
  expect(mockPush).toHaveBeenCalledWith(`/search?keyword=${encodeURIComponent('渋谷')}`);
  expect(dialog).not.toHaveAttribute('open');
  expect(screen.queryByRole('dialog', { name: '駅から探す' })).toBeNull();
});

test('ドロワーは見出しで名前付けされる', () => {
  const dialog = openDrawer();
  expect(dialog).toHaveAttribute('aria-labelledby', 'mobile-filter-dialog-title');
  expect(document.getElementById('mobile-filter-dialog-title')).toHaveTextContent('絞り込み');
});

test('デスクトップのサイドバー（onApplied 無し）は従来どおり遷移だけする', () => {
  render(<SearchFilters />);
  fireEvent.click(screen.getByRole('button', { name: 'この条件で検索' }));
  fireEvent.click(screen.getByRole('button', { name: 'フィルターをクリア' }));
  expect(mockPush).toHaveBeenNthCalledWith(1, '/search?');
  expect(mockPush).toHaveBeenNthCalledWith(2, '/search?');
});

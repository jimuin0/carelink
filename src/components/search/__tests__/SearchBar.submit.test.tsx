import { render, screen, fireEvent } from '@testing-library/react';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/search/SearchSuggest', () => () => null);

import SearchBar from '@/components/search/SearchBar';

beforeEach(() => push.mockClear());

test('状態に入っていない入力値（hydration 前の入力）でもキーワード付きで検索する', () => {
  const { container } = render(<SearchBar />);
  const input = screen.getByPlaceholderText('キーワード（店名・エリアなど）') as HTMLInputElement;
  // React の onChange を通さず DOM の値だけを書き換える＝hydration 前に打たれた文字の再現
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'テスト');
  fireEvent.submit(container.querySelector('form')!);
  expect(push).toHaveBeenCalledWith('/search?keyword=%E3%83%86%E3%82%B9%E3%83%88');
});

test('通常の入力でも業種・地域を含めて検索する', () => {
  const { container } = render(<SearchBar />);
  fireEvent.change(screen.getByPlaceholderText('キーワード（店名・エリアなど）'), { target: { value: '整体' } });
  fireEvent.change(screen.getByLabelText('業種を選択'), { target: { value: 'ヘアサロン' } });
  fireEvent.submit(container.querySelector('form')!);
  expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/search\?keyword=%E6%95%B4%E4%BD%93&type=/));
});

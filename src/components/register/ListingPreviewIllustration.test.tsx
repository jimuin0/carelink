/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import ListingPreviewIllustration from './ListingPreviewIllustration';

test('掲載後の見え方を模式図で見せ、番号つきの一覧で意味を伝える（実在の店舗名は出さない）', () => {
  render(<ListingPreviewIllustration />);
  const figure = screen.getByRole('figure', { name: 'お客様に見える店舗ページ（イメージ）' });
  expect(within(figure).getAllByRole('listitem').map(item => item.textContent))
    .toEqual(['1写真', '2メニューと料金', '3予約ボタン（設定後）']);
  // 画面の中身は飾り（読み上げない）。予約は設定後だけなので、一覧の側で「設定後」と書く。
  expect(within(figure).getByText('予約する').closest('[aria-hidden="true"]')).not.toBeNull();
});

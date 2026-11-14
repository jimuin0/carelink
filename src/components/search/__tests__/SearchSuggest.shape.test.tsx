/** @jest-environment jsdom */
// B6-16: 候補 API の応答の形を確かめてから描画する（想定外の JSON で検索欄ごと落ちない）。
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import SearchSuggest from '../SearchSuggest';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

async function renderWith(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => body });
  render(<SearchSuggest query="渋谷" onSelect={() => {}} visible onClose={() => {}} />);
  await act(async () => { jest.advanceTimersByTime(300); });
  await act(async () => { await Promise.resolve(); });
}

test.each([null, 'x', { facilities: 'x', areas: 1 }, { facilities: [null, { id: 1 }], areas: [1, null] }])('想定外の応答 %p でも落ちず、候補を出さない', async (body) => {
  await renderWith(body);
  expect(screen.queryByRole('button')).toBeNull();
});

test('正しい形の候補は表示する（不正な要素だけ除く）', async () => {
  await renderWith({ facilities: [{ id: 'f1', slug: 's', name: '合成サロン', city: '渋谷区', nearest_station: null, business_type: 'x' }, { id: 2 }], areas: ['渋谷', 3] });
  expect(screen.getByText('合成サロン')).toBeInTheDocument();
  expect(screen.getByText('渋谷')).toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(2);
});

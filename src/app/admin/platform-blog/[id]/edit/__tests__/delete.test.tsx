/**
 * 監査 A31: 削除の応答を確かめずに一覧へ移っていたため、失敗しても削除できたように見え、
 * 通信断では未処理の rejection になり「削除中...」のまま残っていた。
 */
import { Suspense } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Page from '../page';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/useUnsavedGuard', () => ({ useUnsavedGuard: () => {} }));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { title: '合成記事', slug: 'synthetic', description: null, category: null, tags: [], reading_time: 5, content: [], is_published: false }, error: null }) }) }) }),
  }),
}));

async function openAndDelete() {
  const params = Promise.resolve({ id: 'p1' });
  await act(async () => { render(<Suspense fallback={null}><Page params={params} /></Suspense>); });
  fireEvent.click(await screen.findByRole('button', { name: '削除' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '削除する' })); });
}

beforeEach(() => mockPush.mockReset());

test('削除が失敗したら一覧へ移らずエラーを出し、ボタンを戻す', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: '削除できませんでした' }) })) as unknown as typeof fetch;
  await openAndDelete();
  expect(mockPush).not.toHaveBeenCalled();
  expect(await screen.findByText('削除できませんでした')).toBeTruthy();
  expect(screen.getByRole('button', { name: '削除' })).toBeTruthy();
});

test('通信断でも未処理にせずエラーを出す', async () => {
  global.fetch = jest.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch;
  await openAndDelete();
  expect(mockPush).not.toHaveBeenCalled();
  expect(await screen.findByText(/削除に失敗しました/)).toBeTruthy();
});

test('削除が成功したら一覧へ戻る', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
  await openAndDelete();
  expect(mockPush).toHaveBeenCalledWith('/admin/platform-blog');
});

// 監査 A175: 保存に try/finally が無く、通信断で「保存中...」のまま固まりエラーも出なかった。
test('保存が通信断でもボタンを戻してエラーを出す', async () => {
  const params = Promise.resolve({ id: 'p1' });
  await act(async () => { render(<Suspense fallback={null}><Page params={params} /></Suspense>); });
  global.fetch = jest.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch;
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '保存' })); });
  expect(await screen.findByText(/通信に失敗しました/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
});

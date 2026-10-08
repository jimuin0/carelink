/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Page from '../page';

const flag = { id: 'synthetic-flag', key: 'synthetic_feature', enabled: true, rollout_pct: 100, description: null, updated_at: '2026-10-08' };
const mockFetch = jest.fn();
const response = (flags: unknown = [flag], ok = true) => ({ ok, json: async () => ({ flags }) });

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(response());
  global.fetch = mockFetch;
});

test.each(['http', 'network', 'shape'])('読込の%s障害を空一覧にせず、再試行で回復する', async mode => {
  if (mode === 'http') mockFetch.mockResolvedValueOnce(response([], false));
  if (mode === 'network') mockFetch.mockRejectedValueOnce(new Error('network'));
  if (mode === 'shape') mockFetch.mockResolvedValueOnce(response(null));
  render(<Page />);
  expect(await screen.findByRole('alert')).toHaveTextContent('読み込みに失敗しました');
  expect(screen.queryByText('機能フラグがありません')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '更新' }));
  expect(await screen.findByText(flag.key)).toBeVisible();
  expect(screen.queryByText(/読み込みに失敗しました/)).not.toBeInTheDocument();
});

test('正常な0件の応答だけ空一覧を表示する', async () => {
  mockFetch.mockResolvedValue(response([]));
  render(<Page />);
  expect(await screen.findByText('機能フラグがありません')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test.each(['http', 'network'])('保存の%s障害後に現在値を再取得し、操作を回復する', async mode => {
  render(<Page />);
  const toggle = await screen.findByRole('button', { name: 'フラグを無効化' });
  if (mode === 'network') mockFetch.mockRejectedValueOnce(new Error('lost response'));
  else mockFetch.mockResolvedValueOnce(response([], false));
  mockFetch.mockResolvedValueOnce(response([{ ...flag, enabled: false, rollout_pct: 0 }]));
  fireEvent.click(toggle);
  expect(await screen.findByText('更新に失敗しました')).toBeVisible();
  const restored = await screen.findByRole('button', { name: 'フラグを有効化' });
  await waitFor(() => expect(restored).toBeEnabled());
  mockFetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(response());
  fireEvent.click(restored);
  expect(await screen.findByText('更新しました')).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button', { name: 'フラグを無効化' })).toBeEnabled());
});

test('保存後の再取得に失敗した場合は古い値で追加変更させない', async () => {
  render(<Page />);
  const toggle = await screen.findByRole('button', { name: 'フラグを無効化' });
  mockFetch.mockRejectedValueOnce(new Error('lost response')).mockRejectedValueOnce(new Error('read failed'));
  fireEvent.click(toggle);
  expect(await screen.findByText(/読み込みに失敗しました/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'フラグを無効化' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: '更新' })).toBeEnabled());
});

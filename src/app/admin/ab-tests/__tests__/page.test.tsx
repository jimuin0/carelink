/** @jest-environment jsdom */
/**
 * A/Bテスト管理画面は、テストを始められるかのような案内をしない（2026年10月22日）。
 * 以前は「ロールアウト率を1〜99%に設定するとA/Bテストが開始されます」と書いていたが、
 * フラグを読む処理も計測を記録する処理もサイトに無く、テストは始まらなかった。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import Page from '../page';

const mockFetch = jest.fn();
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

test('A/Bテストはまだ実行できないことを伝え、ロールアウト率で始まるとは書かない', async () => {
  mockFetch.mockResolvedValueOnce(json({ flags: [] }));
  render(<Page />);
  expect(await screen.findByText('A/Bテストは、まだ実行できません。')).toBeVisible();
  expect(screen.getByText(/利用者の振り分けも計測も行われません/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Feature Flags' })).toHaveAttribute('href', '/admin/feature-flags');
  expect(screen.getByText('ロールアウト率が1〜99%のフラグはありません。')).toBeVisible();
  const text = document.body.textContent ?? '';
  expect(text).not.toMatch(/A\/Bテストが開始されます|でA\/Bテストを実行|ロールアウト設定 →/);
  expect(text).not.toMatch(/trackAbEvent/);
});

test('ロールアウト率を設定したフラグは、設定値と記録済みの結果だけを表示する', async () => {
  mockFetch
    .mockResolvedValueOnce(json({ flags: [
      { key: 'synthetic_ab', enabled: true, rollout_pct: 50, description: '合成フラグ' },
      { key: 'empty_ab', enabled: true, rollout_pct: 10, description: null },
    ] }))
    .mockResolvedValueOnce(json({
      experiment_key: 'synthetic_ab',
      control: { impression: 10, conversion: 1, conversion_rate: 10 },
      treatment: { impression: 10, conversion: 2, conversion_rate: 20 },
      lift: 10,
    }))
    .mockResolvedValueOnce(json({}, false));
  render(<Page />);
  expect(await screen.findByText('synthetic_ab')).toBeVisible();
  expect(screen.getByText('設定値 treatment 50%')).toBeVisible();
  expect(screen.getByText('合成フラグ')).toBeVisible();
  expect(screen.getByText('20%')).toBeVisible();
  expect(screen.getByText('計測データはありません')).toBeVisible();
});

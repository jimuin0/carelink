/**
 * @jest-environment jsdom
 *
 * 監査 A404: 本文が JSON でない失敗応答を「通信エラー」と取り違えない。
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import IntakeForm from '../IntakeForm';

const template = { id: 't1', title: '問診票', fields: [] };

function submit() {
  render(<IntakeForm facilityId="f1" facilityName="検証院" template={template} />);
  fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: '合成 花子' } });
  fireEvent.click(screen.getByRole('button', { name: '問診票を送信する' }));
}

test('JSON でない失敗応答はサーバー側の失敗として表示する', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.reject(new SyntaxError('bad json')) })) as unknown as typeof fetch;
  submit();
  expect(await screen.findByText('送信に失敗しました')).toBeInTheDocument();
  expect(screen.queryByText('通信エラーが発生しました')).not.toBeInTheDocument();
});

test('失敗応答の error 文言はそのまま出し、通信断は通信エラー', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: '予約が見つかりません' }) })) as unknown as typeof fetch;
  submit();
  expect(await screen.findByText('予約が見つかりません')).toBeInTheDocument();
});

test('通信断は通信エラーと表示する', async () => {
  global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
  submit();
  expect(await screen.findByText('通信エラーが発生しました')).toBeInTheDocument();
});

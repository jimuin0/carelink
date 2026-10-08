/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InquiryForm from '../InquiryForm';

jest.mock('@/components/ConfirmDialog', () => ({ __esModule: true, default: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => open ? <button onClick={onConfirm}>確認して送信</button> : null }));
jest.mock('@/components/Toast', () => ({ __esModule: true, default: () => null }));

const fetchMock = jest.fn();
const originalFetch = global.fetch;
beforeEach(() => { fetchMock.mockReset().mockResolvedValue({ ok: true }); global.fetch = fetchMock; });
afterAll(() => { global.fetch = originalFetch; });

function fill(name: string, message: string) {
  fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText(/お問い合わせ内容/), { target: { value: message } });
  fireEvent.click(screen.getByRole('button', { name: 'お問い合わせを送信する' }));
}

it.each([['   ', '内容'], ['名前', ' \n '], ['あ'.repeat(101), '内容']])('不正な入力は確認前に拒否する: %s', async (name, message) => {
  render(<InquiryForm facilityId="123e4567-e89b-12d3-a456-426614174000" />);
  fill(name, message);
  await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
  expect(screen.queryByText('確認して送信')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('最大100文字の名前を受け入れ、前後空白を除去した本文をAPIへ送る', async () => {
  render(<InquiryForm facilityId="123e4567-e89b-12d3-a456-426614174000" />);
  fill(` ${'あ'.repeat(100)} `, '  内容  ');
  fireEvent.click(await screen.findByText('確認して送信'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body).toEqual({ facility_id: '123e4567-e89b-12d3-a456-426614174000', name: 'あ'.repeat(100), email: 'test@example.com', phone: null, message: '内容' });
});

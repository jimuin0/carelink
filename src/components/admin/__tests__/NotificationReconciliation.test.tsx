import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NotificationReconciliation from '../NotificationReconciliation';

const operationId = '11111111-1111-4111-8111-111111111111';
const providerMessageId = '22222222-2222-4222-8222-222222222222';
const fetchMock = jest.fn();
beforeEach(() => { fetchMock.mockReset(); global.fetch = fetchMock; });
function fill() {
  fireEvent.change(screen.getByLabelText('操作ID'), { target: { value: operationId } });
  fireEvent.change(screen.getByLabelText('メールサービスのメッセージID'), { target: { value: providerMessageId } });
}
const click = () => fireEvent.click(screen.getByRole('button', { name: '受理記録を照合（送信しない）' }));
test('invalid identifiers never send a request', () => {
  render(<NotificationReconciliation />); click();
  expect(screen.getByRole('alert')).toHaveTextContent('UUID');
  expect(fetchMock).not.toHaveBeenCalled();
});
test('verified acceptance is not claimed as inbox delivery; only opaque IDs sent', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ accepted: true }) });
  render(<NotificationReconciliation />); fill(); click();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('配達完了を意味しません'));
  expect(fetchMock).toHaveBeenCalledWith('/api/admin/notification-reconciliation', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId, providerMessageId }),
  });
  fireEvent.change(screen.getByLabelText('操作ID'), { target: { value: '' } });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
test.each([{ ok: false, data: { accepted: true } }, { ok: true, data: { accepted: false } }, { ok: true, data: null }])('HTTP/business failure never becomes success %j', async ({ ok, data }) => {
  fetchMock.mockResolvedValue({ ok, json: async () => data });
  render(<NotificationReconciliation />); fill(); click();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('再送は行っていません'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
test('broken JSON and network ambiguity remain unknown without resending', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('invalid'); } })
    .mockRejectedValueOnce(new Error('timeout'));
  render(<NotificationReconciliation />); fill(); click();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('確定できません'));
  click();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('結果が不明'));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
test('duplicate clicks are synchronously fenced; request completion unlocks fields', async () => {
  let finish!: (result: unknown) => void;
  fetchMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<NotificationReconciliation />); fill(); click();
  fireEvent.click(screen.getByRole('button', { name: '照合中…' }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('操作ID')).toBeDisabled();
  finish({ ok: true, json: async () => ({ accepted: true }) });
  await waitFor(() => expect(screen.getByLabelText('操作ID')).not.toBeDisabled());
});

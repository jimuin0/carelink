import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
jest.mock('@/lib/line-availability', () => ({ isLineEnabled: () => false }));
import AdjustRequestButtons from '../AdjustRequestButtons';
let request: jest.Mock;
beforeEach(() => {
  sessionStorage.clear(); request = jest.fn(); global.fetch = request as typeof fetch;
  Object.defineProperty(crypto,'randomUUID',{ configurable:true,value:jest.fn(() => 'e5000000-0000-4000-8000-000000000001') });
});
function show(status = 'confirmed') { render(<AdjustRequestButtons bookingId="synthetic" status={status} />); }
test.each(['completed','cancelled','arrived'])('no sending control for status %s', status => {
  show(status); expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
test.each([null,{}, { ok:false }, { ok:true }, { ok:true,notification:'sent' }])('HTTP 200 %j is not success', async body => {
  request.mockResolvedValue({ ok:true,json:async () => body }); show();
  fireEvent.click(screen.getByRole('button',{ name:'メールで送る（無料）' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('受付を確認できません');
});
test.each(['queued','already_queued'])('valid event %s does not claim inbox delivery', async notification => {
  request.mockResolvedValue({ ok:true,json:async () => ({ ok:true,notification }) }); show();
  fireEvent.click(screen.getByRole('button',{ name:'メールで送る（無料）' }));
  const alert = await screen.findByRole('alert');
  expect(alert).not.toHaveTextContent('メールで送信しました');
  expect(alert).toHaveTextContent(notification === 'queued' ? '受け付けました' : '受付済み');
});
test('lost response neither guarantees automatic retry nor encourages a different operation', async () => {
  request.mockRejectedValue(new Error('response lost')); show();
  fireEvent.click(screen.getByRole('button',{ name:'メールで送る（無料）' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('保存した操作を照合');
});
test('unknown result survives remount and uses the same operation after a booking change', async () => {
  request.mockRejectedValueOnce(new Error('response lost'));
  const first = render(<AdjustRequestButtons bookingId="synthetic" status="pending" />);
  fireEvent.click(screen.getByRole('button')); await screen.findByRole('alert');
  const op = JSON.parse(request.mock.calls[0][1].body).operationId;
  first.unmount(); request.mockResolvedValueOnce({ ok:true,json:async () => ({ ok:true,notification:'already_queued' }) });
  show('confirmed'); fireEvent.click(screen.getByRole('button')); await screen.findByRole('alert');
  expect(JSON.parse(request.mock.calls[1][1].body).operationId).toBe(op);
  expect(sessionStorage.getItem('carelink-adjust-operation/synthetic')).toBeNull();
});
test('corrupt saved operation does not start a different request', async () => {
  sessionStorage.setItem('carelink-adjust-operation/synthetic','invalid'); show(); fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('alert'); expect(request).not.toHaveBeenCalled();
});
test.each(['cancelled','arrived','completed'])('saved operation remains recoverable in %s without a new send identity', async status => {
  const op='e5000000-0000-4000-8000-000000000001';
  sessionStorage.setItem('carelink-adjust-operation/synthetic',op);
  request.mockResolvedValue({ ok:true,json:async () => ({ ok:true,notification:'already_queued' }) });
  show(status); fireEvent.click(await screen.findByRole('button',{ name:'メールの受付結果を照合' }));
  await screen.findByRole('alert');
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ bookingId:'synthetic',channel:'email',operationId:op });
  expect(crypto.randomUUID).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{ name:'メールの受付結果を照合' })).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('受付済み');
});
test('synchronous duplicate click starts one request', async () => {
  let resolve: ((value:unknown) => void) | undefined;
  request.mockReturnValue(new Promise(r => { resolve = r; })); show();
  const button = screen.getByRole('button',{ name:'メールで送る（無料）' });
  fireEvent.click(button); fireEvent.click(button); expect(request).toHaveBeenCalledTimes(1);
  resolve?.({ ok:true,json:async () => ({ ok:true,notification:'queued' }) });
  await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
});

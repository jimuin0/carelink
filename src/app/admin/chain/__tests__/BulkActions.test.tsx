import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter:() => ({ refresh:mockRefresh }) }));
jest.mock('@/components/Toast', () => ({ __esModule:true, default:({ message,type }: { message:string;type:string }) => <div role="alert" data-kind={type}>{message}</div> }));
jest.mock('@/components/ConfirmDialog', () => ({ __esModule:true, default:({ open,onConfirm }: { open:boolean;onConfirm:() => void }) => open ? <button onClick={onConfirm}>確認する</button> : null }));
import BulkActions from '../BulkActions';
let fetchMock:jest.Mock;
beforeEach(() => { jest.clearAllMocks(); fetchMock=jest.fn(); global.fetch=fetchMock as typeof fetch; });
function setup() { render(<BulkActions facilityIds={['f1','f2']} facilityNames={[{ id:'f1',name:'合成1' },{ id:'f2',name:'合成2' }]} />); }
async function publish() { setup(); fireEvent.click(screen.getByText('公開状態一括変更')); fireEvent.click(screen.getByText('2施設を一括公開')); fireEvent.click(screen.getByText('確認する')); await screen.findByRole('alert'); }
test('partial publication reports skipped stores, never whole-chain success', async () => {
  fetchMock.mockResolvedValue({ ok:true,json:async () => ({ ok:true,updated:1,skipped:[{ facility_id:'f2',missing:['住所'] }] }) });
  await publish(); expect(screen.getByRole('alert')).toHaveAttribute('data-kind','error');
  expect(screen.getByRole('alert')).toHaveTextContent('1施設は掲載準備が不足'); expect(mockRefresh).toHaveBeenCalledTimes(1);
});
test('complete publication is confirmed from the exact business result', async () => {
  fetchMock.mockResolvedValue({ ok:true,json:async () => ({ ok:true,updated:2,skipped:[] }) });
  await publish(); expect(screen.getByRole('alert')).toHaveAttribute('data-kind','success');
});
test.each([{},null,{ ok:true,updated:0,skipped:[] },{ ok:true,updated:1,skipped:[{ facility_id:'other',missing:[] }] }])('HTTP 200 with invalid result %j is not success', async value => {
  fetchMock.mockResolvedValue({ ok:true,json:async () => value }); await publish();
  expect(screen.getByRole('alert')).toHaveTextContent('変更結果を確認できません'); expect(mockRefresh).not.toHaveBeenCalled();
});
test('network or broken JSON does not escape or become a false success', async () => {
  fetchMock.mockRejectedValue(new Error('timeout')); await publish();
  expect(screen.getByRole('alert')).toHaveTextContent('変更結果を確認できません');
});
test.each([{ ok:true,created:2 },{},null])('coupon form resets only for confirmed complete issuance %j', async data => {
  fetchMock.mockResolvedValue({ ok:true,json:async () => data }); setup();
  fireEvent.change(screen.getByLabelText(/クーポン名/),{ target:{ value:'合成' } });
  fireEvent.change(screen.getByLabelText(/割引率\(%\).*\*/),{ target:{ value:'10' } });
  fireEvent.click(screen.getByText('2施設に一括発行')); await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByLabelText(/クーポン名/)).toHaveValue(data?.created === 2 ? '' : '合成'));
  expect(screen.getByRole('alert')).toHaveAttribute('data-kind',data?.created === 2 ? 'success' : 'error');
});

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RegistrationDuplicateLink from '../RegistrationDuplicateLink';
const duplicateId = 'b2000000-0000-4000-8000-000000000002';
const canonicalId = 'b2000000-0000-4000-8000-000000000001';
const facilityId = 'b5000000-0000-4000-8000-000000000001';
const preview = { outcome: 'preview', duplicateId, canonicalId, duplicateRevision: 0, canonicalRevision: 1,
  facilityId, name: 'Synthetic', businessType: 'ヘアサロン', prefecture: '合成県', city: '合成市', address: '合成住所', building: '合成部屋' };
const fetchMock = jest.fn();
const respond = (data: unknown, status = 200) => ({ ok: status === 200, status, json: async () => data });
beforeEach(() => { fetchMock.mockReset().mockResolvedValue(respond(preview)); global.fetch = fetchMock; });
const choose = () => { fireEvent.change(screen.getByLabelText('未取り込みの受付番号'), { target: { value: duplicateId } });
  fireEvent.change(screen.getByLabelText('店舗作成済みの受付番号'), { target: { value: canonicalId } }); };
const load = async () => { choose(); fireEvent.click(screen.getByRole('button', { name: '比較・記録を確認する' }));
  await screen.findByText('Synthetic／ヘアサロン'); };
test('no automatic load or linkage; invalid IDs never call API', async () => {
  render(<RegistrationDuplicateLink />); expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '比較・記録を確認する' }));
  expect(await screen.findByText(/異なる2件/)).toBeInTheDocument(); expect(fetchMock).not.toHaveBeenCalled();
});
test('explicit comparison, same-site consent and exact revision CAS; no membership link', async () => {
  render(<RegistrationDuplicateLink />); await load();
  expect(screen.getByText('合成県 合成市 合成住所 合成部屋')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '元申込を保持して関連付ける' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox')); fetchMock.mockResolvedValue(respond({ outcome: 'linked', facilityId }));
  fireEvent.click(screen.getByRole('button', { name: '元申込を保持して関連付ける' }));
  await screen.findByText(/関連付け記録を確認しました/);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: 'link', duplicateId, canonicalId, duplicateRevision: 0, canonicalRevision: 1, sameSite: true });
  expect(screen.queryByRole('link')).not.toBeInTheDocument(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
test('input edit invalidates old comparison and consent', async () => {
  render(<RegistrationDuplicateLink />); await load(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('未取り込みの受付番号'), { target: { value: canonicalId } });
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '比較・記録を確認する' })); expect(fetchMock).toHaveBeenCalledTimes(1);
});
test('read-only replay reconciles an existing record without another commit', async () => {
  fetchMock.mockResolvedValue(respond({ outcome: 'replay', facilityId })); render(<RegistrationDuplicateLink />); choose();
  fireEvent.click(screen.getByRole('button', { name: '比較・記録を確認する' })); await screen.findByText(/関連付け記録を確認しました/);
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
test.each([respond({}, 500), respond({}, 200), respond({ outcome: 'linked', facilityId }, 500)])('ambiguous commit requires reconciliation, never says failed definitively %#', async response => {
  render(<RegistrationDuplicateLink />); await load(); fetchMock.mockResolvedValue(response); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '元申込を保持して関連付ける' })); await screen.findByText(/結果が不明です/);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(fetchMock).toHaveBeenCalledTimes(2);
});
test('transport exception preserves unknown and does not retry', async () => {
  render(<RegistrationDuplicateLink />); await load(); fetchMock.mockRejectedValue(new Error('network')); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '元申込を保持して関連付ける' })); await screen.findByText(/結果が不明です/); expect(fetchMock).toHaveBeenCalledTimes(2);
});
test.each([respond({}, 500), respond({ ...preview, duplicateId: canonicalId }), respond({ outcome: 'conflict' }, 409)])('failed, wrong-pair, and rejected previews cannot authorize linkage %#', async response => {
  fetchMock.mockResolvedValue(response); render(<RegistrationDuplicateLink />); choose();
  fireEvent.click(screen.getByRole('button', { name: '比較・記録を確認する' })); await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
test('pending request prevents duplicate submission, input mutation, and unmount aborts', async () => {
  let complete!: (value: unknown) => void;
  fetchMock.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const view = render(<RegistrationDuplicateLink />); choose(); const button = screen.getByRole('button', { name: '比較・記録を確認する' });
  fireEvent.click(button); fireEvent.click(button); expect(fetchMock).toHaveBeenCalledTimes(1); expect(button).toBeDisabled();
  const signal = fetchMock.mock.calls[0][1].signal; view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => { complete(respond(preview)); });
});

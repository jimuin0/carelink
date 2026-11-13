/**
 * 監査 A85: 紹介手数料の入力欄が応募者を切り替えても作り直されず、前の応募者の金額が
 * 残ったまま blur で別の応募者へ保存されていた（請求額の誤登録）。値を変えなくても保存されていた。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Page from '../page';

const apps = [
  { id: 'a', applicant_name: '応募者A', applicant_email: 'a@example.invalid', applicant_phone: null, cover_letter: null, status: 'hired', referral_fee_yen: 300000, hired_at: null, fee_paid_at: null, created_at: '2026-10-01T00:00:00Z' },
  { id: 'b', applicant_name: '応募者B', applicant_email: 'b@example.invalid', applicant_phone: null, cover_letter: null, status: 'hired', referral_fee_yen: null, hired_at: null, fee_paid_at: null, created_at: '2026-10-02T00:00:00Z' },
];
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (url: string) => (
    url === '/api/admin/job-applications'
      ? { ok: true, json: async () => ({ applications: apps }) }
      : { ok: true, json: async () => ({ application: apps[1] }) }
  ));
  global.fetch = fetchMock as unknown as typeof fetch;
});

const patches = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');

test('応募者を切り替えると入力欄はその応募者の金額になり、前の金額を保存しない', async () => {
  render(<Page />);
  fireEvent.click(await screen.findByText('応募者A'));
  expect(screen.getByPlaceholderText('例: 300000')).toHaveProperty('value', '300000');
  fireEvent.click(screen.getByText('応募者B'));
  const input = screen.getByPlaceholderText('例: 300000');
  expect(input).toHaveProperty('value', '');
  fireEvent.blur(input);
  expect(patches()).toHaveLength(0);
});

test('金額を変えずにフォーカスを外しても保存しない', async () => {
  render(<Page />);
  fireEvent.click(await screen.findByText('応募者A'));
  fireEvent.blur(screen.getByPlaceholderText('例: 300000'));
  await waitFor(() => expect(patches()).toHaveLength(0));
});

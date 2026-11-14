/**
 * @jest-environment jsdom
 *
 * 監査 A336: 取得の例外で「読み込み中...」のまま止めず、エラーと再試行を出す。
 * 監査 A338: 削除の確定を連打しても DELETE は1回だけ送る。
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import EditJobPage from '../page';

const mockPush = jest.fn();
const mockRouter = { push: mockPush, refresh: jest.fn() };
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'job-1' }),
  useRouter: () => mockRouter,
}));
jest.mock('@/components/ConfirmDialog', () => ({
  __esModule: true,
  default: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => open
    ? <><button type="button" onClick={onConfirm}>確定1</button><button type="button" onClick={onConfirm}>確定2</button></>
    : null,
}));

const job = { title: '合成求人', job_type: '施術者', employment_type: '正社員' };

beforeEach(() => jest.clearAllMocks());

test('取得の例外ではエラーと再試行を出し、再試行で読み込める', async () => {
  const fetchMock = jest.fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValue({ ok: true, json: () => Promise.resolve({ job }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  render(<EditJobPage />);
  expect(await screen.findByText('求人の取得に失敗しました')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(await screen.findByText('この求人を削除')).toBeInTheDocument();
});

test('削除の確定を続けて押しても DELETE は1回だけ', async () => {
  let resolveDelete!: (v: unknown) => void;
  const fetchMock = jest.fn((_url: string, init?: RequestInit) => init?.method === 'DELETE'
    ? new Promise((r) => { resolveDelete = r; })
    : Promise.resolve({ ok: true, json: () => Promise.resolve({ job }) }));
  global.fetch = fetchMock as unknown as typeof fetch;
  render(<EditJobPage />);
  fireEvent.click(await screen.findByText('この求人を削除'));
  const first = screen.getByRole('button', { name: '確定1' });
  const second = screen.getByRole('button', { name: '確定2' });
  fireEvent.click(first);
  fireEvent.click(second);
  await act(async () => { resolveDelete({ ok: true, json: () => Promise.resolve({}) }); });
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  expect(mockPush).toHaveBeenCalledWith('/admin/jobs');
});

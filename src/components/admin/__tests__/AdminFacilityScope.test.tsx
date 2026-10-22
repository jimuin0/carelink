/** @jest-environment jsdom */
// 管理画面（クライアント）の店舗の決め方（2026年10月22日）。店舗が決まるまで本体を描画しないこと、
// 決まった店舗と所属の一覧だけを本体へ渡すこと、店舗を切り替えたら本体を作り直すことを固定する。
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import AdminFacilityScope from '../AdminFacilityScope';

const A = 'aa850000-0000-4000-8000-000000000001';
const B = 'aa850000-0000-4000-8000-000000000002';
let mockQuery = '';
const selection = jest.fn();
const getUser = jest.fn();
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(mockQuery), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({ auth: { getUser: () => getUser() } }) }));
jest.mock('@/lib/admin-facility-selection', () => ({ loadAdminFacilitySelection: (...args: unknown[]) => selection(...args) }));

const choices = [{ id: A, name: '合成店舗A' }, { id: B, name: '合成店舗B' }];
function Body({ facilityId, userId, count }: { facilityId: string; userId: string; count: number }) {
  // 店舗を切り替えたときに前の店舗の入力が残らないことを見るための状態
  const [draft, setDraft] = useState('');
  return <div>
    <p>本体:{facilityId}:{userId}:{count}</p>
    <label>下書き<input value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
  </div>;
}
const renderScope = () => render(
  <AdminFacilityScope title="合成画面" path="/admin/qa">
    {(scope) => <Body facilityId={scope.facilityId} userId={scope.userId} count={scope.choices.length} />}
  </AdminFacilityScope>,
);

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = '';
  getUser.mockResolvedValue({ data: { user: { id: 'synthetic-owner' } }, error: null });
  selection.mockImplementation(async (_db: unknown, _user: string, requested: string | null) => ({ choices, selectedId: requested }));
});

test('the body receives only a confirmed store, the verified user and the choices', async () => {
  mockQuery = `facility_id=${B}`;
  renderScope();
  await screen.findByText(`本体:${B}:synthetic-owner:2`);
  expect(selection).toHaveBeenCalledWith(expect.anything(), 'synthetic-owner', B);
});

test('without a selection the page title and the store choices are shown instead of the body', async () => {
  renderScope();
  await screen.findByText('編集する店舗を選択してください');
  expect(screen.getByRole('heading', { name: '合成画面' })).toBeTruthy();
  expect(screen.queryByText(/本体:/)).toBeNull();
});

test('an owner with no manageable store sees that, not a body', async () => {
  selection.mockResolvedValue({ choices: [], selectedId: null });
  renderScope();
  await screen.findByText('管理できる店舗がありません。');
  expect(screen.queryByText(/本体:/)).toBeNull();
});

test('a failed check can be retried and then shows the body', async () => {
  mockQuery = `facility_id=${A}`;
  selection.mockRejectedValueOnce(new Error('facility_selection_unavailable'));
  renderScope();
  await screen.findByText('管理する店舗の確認に失敗しました');
  expect(screen.queryByText(/本体:/)).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '再試行' })); });
  await screen.findByText(`本体:${A}:synthetic-owner:2`);
  expect(selection).toHaveBeenCalledTimes(2);
});

test('an unconfirmed session never reaches the membership check', async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  mockQuery = `facility_id=${A}`;
  renderScope();
  await screen.findByRole('alert');
  expect(selection).not.toHaveBeenCalled();
});

test('switching the store rebuilds the body so the previous store’s input does not carry over', async () => {
  mockQuery = `facility_id=${A}`;
  const view = renderScope();
  await screen.findByText(`本体:${A}:synthetic-owner:2`);
  fireEvent.change(screen.getByLabelText('下書き'), { target: { value: '店舗A向けの下書き' } });
  mockQuery = `facility_id=${B}`;
  view.rerender(
    <AdminFacilityScope title="合成画面" path="/admin/qa">
      {(scope) => <Body facilityId={scope.facilityId} userId={scope.userId} count={scope.choices.length} />}
    </AdminFacilityScope>,
  );
  await screen.findByText(`本体:${B}:synthetic-owner:2`);
  expect((screen.getByLabelText('下書き') as HTMLInputElement).value).toBe('');
});

test('a late answer for the previous store cannot replace the newly selected store', async () => {
  let finishFirst!: (value: unknown) => void;
  selection.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
  mockQuery = `facility_id=${A}`;
  const view = renderScope();
  mockQuery = `facility_id=${B}`;
  view.rerender(
    <AdminFacilityScope title="合成画面" path="/admin/qa">
      {(scope) => <Body facilityId={scope.facilityId} userId={scope.userId} count={scope.choices.length} />}
    </AdminFacilityScope>,
  );
  await screen.findByText(`本体:${B}:synthetic-owner:2`);
  await act(async () => { finishFirst({ choices, selectedId: A }); });
  expect(screen.queryByText(`本体:${A}:synthetic-owner:2`)).toBeNull();
  expect(screen.getByText(`本体:${B}:synthetic-owner:2`)).toBeTruthy();
});

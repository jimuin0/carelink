import { fireEvent, render, screen } from '@testing-library/react';
import FacilitySelector, { loadAdminFacilitySelection } from '../FacilitySelector';
import type { createBrowserSupabaseClient } from '@/lib/supabase-browser';
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
beforeEach(() => jest.clearAllMocks());

const first = '71000000-0000-4000-8000-000000000001';
const second = '71000000-0000-4000-8000-000000000002';
const absent = '71000000-0000-4000-8000-000000000003';
const fixture = [{ facility_id: first, facility_profiles: { name: '合成店舗A' } },
  { facility_id: second, facility_profiles: { name: '合成店舗B' } }];
function db(data: unknown = fixture, error: unknown = null) {
  const chain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data, error }) };
  return { value: { from: jest.fn(() => chain) } as unknown as ReturnType<typeof createBrowserSupabaseClient>, chain };
}
test('multiple memberships require an explicit selection', async () => {
  const query = db();
  expect(await loadAdminFacilitySelection(query.value, 'synthetic-user', null)).toMatchObject({ selectedId: null });
  expect(query.chain.eq).toHaveBeenCalledWith('user_id', 'synthetic-user');
  expect(query.chain.in).toHaveBeenCalledWith('role', ['owner', 'admin']);
});
test('one membership is selected, requested membership must match', async () => {
  expect((await loadAdminFacilitySelection(db(fixture.slice(0, 1)).value, 'synthetic', null)).selectedId).toBe(first);
  expect((await loadAdminFacilitySelection(db().value, 'synthetic', second)).selectedId).toBe(second);
});
test.each(['invalid', absent])('invalid or unauthorized ID never falls back to first store %s', async requested => {
  await expect(loadAdminFacilitySelection(db().value, 'synthetic', requested)).rejects.toThrow();
});
test.each([[null, null], [fixture, { code: '08006' }], [Array(101).fill(fixture[0]), null]])('unavailable memberships fail closed %#', async (data, error) => {
  await expect(loadAdminFacilitySelection(db(data, error).value, 'synthetic', null)).rejects.toThrow();
});
test('empty memberships do not select a store', async () => {
  expect((await loadAdminFacilitySelection(db([]).value, 'synthetic', null)).selectedId).toBeNull();
  render(<FacilitySelector choices={[]} selectedId={null} path="/admin/photos" />);
  expect(screen.getByRole('status').textContent).toContain('ありません');
});
test('missing display name does not lose the authorized membership', async () => {
  expect((await loadAdminFacilitySelection(db([{ facility_id: first, facility_profiles: null }]).value, 'synthetic', null)).choices)
    .toEqual([{ id: first, name: '名称未設定の店舗' }]);
});
test('unselected stores show selection instruction and photos carry ID back to settings', () => {
  const { rerender } = render(<FacilitySelector choices={[{ id: first, name: '合成店舗A' }]} selectedId={null} path="/admin/photos" />);
  expect(screen.getByText('編集する店舗を選択してください')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'この店舗の基本情報を編集' })).toBeNull();
  rerender(<FacilitySelector choices={[{ id: first, name: '合成店舗A' }]} selectedId={first} path="/admin/photos" />);
  expect(screen.getByRole('link', { name: 'この店舗の基本情報を編集' }).getAttribute('href')).toBe(`/admin/settings?facility_id=${first}`);
});
test('selected store is displayed and carried across settings and photos', () => {
  render(<FacilitySelector choices={[{ id: first, name: '合成店舗A' }, { id: second, name: '合成店舗B' }]}
    selectedId={second} path="/admin/settings" />);
  expect(screen.getByRole('link', { name: '合成店舗B（選択中）' }).getAttribute('href')).toBe(`/admin/settings?facility_id=${second}`);
  expect(screen.getByRole('link', { name: 'この店舗の写真を管理' }).getAttribute('href')).toBe(`/admin/photos?facility_id=${second}`);
});

test('dirty navigation is explicit and cancellation preserves inputs', () => {
  render(<FacilitySelector choices={[{ id: second, name: '合成店舗B' }]} selectedId={first} path="/admin/settings" dirty />);
  fireEvent.click(screen.getByRole('link', { name: '合成店舗B' }));
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
  expect(mockPush).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: '合成店舗B' }));
  fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }));
  expect(mockPush).toHaveBeenCalledWith(`/admin/settings?facility_id=${second}`);
});
test('busy blocks both new navigation and an already open confirmation', () => {
  const props = { choices: [{ id: second, name: '合成店舗B' }], selectedId: first, path: '/admin/settings' as const, dirty: true };
  const { rerender } = render(<FacilitySelector {...props} busy />);
  fireEvent.click(screen.getByRole('link', { name: '合成店舗B' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  rerender(<FacilitySelector {...props} busy={false} />);
  fireEvent.click(screen.getByRole('link', { name: '合成店舗B' }));
  rerender(<FacilitySelector {...props} busy />);
  expect((screen.getByRole('button', { name: '破棄して移動' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }));
  expect(mockPush).not.toHaveBeenCalled();
});
test('clean navigation does not require a confirmation', () => {
  render(<FacilitySelector choices={[{ id: second, name: '合成店舗B' }]} selectedId={first} path="/admin/settings" />);
  fireEvent.click(screen.getByRole('link', { name: '合成店舗B' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('schedule selection preserves the date and does not pretend to be a settings editor', () => {
  render(<FacilitySelector choices={[{ id: second, name: '合成店舗B' }]} selectedId={first}
    path="/admin/schedule" date="2026-10-01" />);
  expect(screen.getByRole('link', { name: '合成店舗B' }).getAttribute('href'))
    .toBe(`/admin/schedule?facility_id=${second}&date=2026-10-01`);
  expect(screen.queryByRole('link', { name: 'この店舗の基本情報を編集' })).toBeNull();
});

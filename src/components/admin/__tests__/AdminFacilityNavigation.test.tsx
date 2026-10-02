import { render, screen, fireEvent } from '@testing-library/react';
import AdminTopNav from '../AdminTopNav';
import AdminMobileNav from '../AdminMobileNav';
import AdminFacilityLink from '../AdminFacilityLink';
import AdminSelectedFacilityName from '../AdminSelectedFacilityName';
import AdminSelectedFacilityNotifications from '../AdminSelectedFacilityNotifications';
jest.mock('@/components/admin/DynamicAdminWidgets', () => ({ RealtimeBookingListener: ({ facilityId }: { facilityId: string }) => <div data-testid="listener">{facilityId}</div> }));
const id = '00000000-0000-4000-8000-000000000002';
jest.mock('next/navigation', () => ({ usePathname: () => '/admin/menus', useSearchParams: () => new URLSearchParams(`facility_id=${id}`) }));
const groups = [{ key: 'listing', label: '掲載管理', items: [{ href: '/admin/menus', label: 'メニュー' }, { href: '/admin/staff', label: 'スタッフ' }] }, { key: 'home', label: 'ホーム', items: [{ href: '/admin', label: 'ダッシュボード' }] }];
beforeEach(() => { global.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }; });
test('desktop tabs and submenu keep selected store', () => {
  render(<AdminTopNav groups={groups} />);
  expect(screen.getByRole('link', { name: '掲載管理' }).getAttribute('href')).toBe(`/admin/menus?facility_id=${id}`);
  expect(screen.getByRole('link', { name: 'スタッフ' }).getAttribute('href')).toBe(`/admin/staff?facility_id=${id}`);
  expect(screen.getByRole('link', { name: 'ホーム' }).getAttribute('href')).toBe(`/admin?facility_id=${id}`);
});
test('mobile primary and more menu keep selected store', () => {
  render(<AdminMobileNav items={[{ href: '/admin', label: 'ホーム', icon: '' }]} groups={groups} />);
  expect(screen.getByRole('link', { name: 'ホーム' }).getAttribute('href')).toBe(`/admin?facility_id=${id}`);
  fireEvent.click(screen.getByRole('button', { name: 'その他' }));
  expect(screen.getByRole('link', { name: 'スタッフ' }).getAttribute('href')).toBe(`/admin/staff?facility_id=${id}`);
});
test('header home link returns to selected store', () => {
  render(<AdminFacilityLink href="/admin">管理画面</AdminFacilityLink>);
  expect(screen.getByRole('link').getAttribute('href')).toBe(`/admin?facility_id=${id}`);
});

test('shell labels selected second store, never arbitrary first store', () => {
  render(<AdminSelectedFacilityName choices={[{ id: '00000000-0000-4000-8000-000000000001', name: '合成店舗A' }, { id, name: '合成店舗B' }]} />);
  expect(screen.getByLabelText('選択店舗').textContent).toBe('合成店舗B');
  expect(screen.queryByText('合成店舗A')).toBeNull();
});
test('unrecognized selected ID never labels first store', () => {
  render(<AdminSelectedFacilityName choices={[{ id: '00000000-0000-4000-8000-000000000001', name: '合成店舗A' }]} />);
  expect(screen.getByLabelText('選択店舗').textContent).toBe('店舗未選択');
});

test('realtime subscription belongs to selected store only', () => {
  const { rerender } = render(<AdminSelectedFacilityNotifications choices={[{ id: '00000000-0000-4000-8000-000000000001', name: '合成店舗A' }, { id, name: '合成店舗B' }]} />);
  expect(screen.getByTestId('listener').textContent).toBe(id);
  rerender(<AdminSelectedFacilityNotifications choices={[{ id: '00000000-0000-4000-8000-000000000001', name: '合成店舗A' }]} />);
  expect(screen.queryByTestId('listener')).toBeNull();
});

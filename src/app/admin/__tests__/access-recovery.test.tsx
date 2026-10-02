/** @jest-environment node */
import { type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminLayout from '../layout';
import RegistrationsLayout from '../registrations/layout';
import BookingsPage from '../bookings/page';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';

const mockClient = jest.fn(), mockGetUser = jest.fn(), mockFrom = jest.fn();
const mockRedirect = jest.fn(), mockNotFound = jest.fn(), mockSelection = jest.fn();
let mockPath = '/admin/bookings';
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: () => mockClient() }));
jest.mock('next/headers', () => ({ headers: async () => ({ get: () => mockPath }) }));
jest.mock('next/navigation', () => ({ redirect: (url: string) => mockRedirect(url), notFound: () => mockNotFound() }));
jest.mock('@/lib/admin-facility-selection', () => ({ loadAdminFacilitySelection: (...args: unknown[]) => mockSelection(...args) }));
jest.mock('@/components/admin/AdminMobileNav', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/admin/AdminTopNav', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/admin/AdminUserMenu', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/admin/DynamicAdminWidgets', () => ({ RealtimeBookingListener: () => null, AiSupportWidget: () => null }));
jest.mock('@/components/admin/FacilitySelector', () => ({ __esModule: true, default: () => null }));

const child = <span>synthetic protected business child</span>;
let members: { data: unknown; error: unknown }, profile: { data: unknown; error: unknown };
let mockDbThrow: string | null;
beforeEach(() => {
  jest.clearAllMocks(); mockPath = '/admin/bookings'; mockDbThrow = null;
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
  mockClient.mockReset().mockResolvedValue({ auth: { getUser: mockGetUser }, from: mockFrom });
  mockRedirect.mockImplementation(() => { throw new Error('synthetic redirect'); });
  mockNotFound.mockImplementation(() => { throw new Error('synthetic notFound'); });
  mockSelection.mockReset().mockResolvedValue({ choices: [], selectedId: null });
  members = { data: [{ role: 'owner', facility_id: 'synthetic-facility', facility_profiles: { name: 'Synthetic facility' } }], error: null };
  profile = { data: { is_platform_admin: false }, error: null };
  mockFrom.mockImplementation((table: string) => {
    const result = () => mockDbThrow === table ? Promise.reject(new Error('synthetic DB failure')) : Promise.resolve(table === 'profiles' ? profile : members);
    const chain = { select: () => chain, eq: () => chain, in: result, single: result };
    return chain;
  });
});
async function shell() {
  const inner = AdminLayout({ children: child }).props.children as ReactElement<{ children: ReactNode }>;
  return (inner.type as (props: { children: ReactNode }) => Promise<ReactElement>)(inner.props);
}
const targets = {
  shell,
  registrations: () => RegistrationsLayout({ children: child }),
  bookings: () => BookingsPage({ searchParams: Promise.resolve({ facility_id: '71000000-0000-4000-8000-000000000002' }) }),
};
test.each(Object.keys(targets) as (keyof typeof targets)[])('%s Auth outage returns explicit retry without protected reads or denied redirects', async target => {
  for (const response of [{ data: { user: null }, error: { status: 522 } }, {}, { data: { user: { id: 'synthetic-user' } }, error: {} }]) {
    mockGetUser.mockResolvedValue(response);
    const markup = renderToStaticMarkup(await targets[target]());
    expect(markup).toContain('利用権限を再確認'); expect(markup).not.toContain('synthetic protected business child');
  }
  mockGetUser.mockRejectedValue(new Error('synthetic network failure'));
  expect(renderToStaticMarkup(await targets[target]())).toContain('利用権限を再確認');
  expect(mockFrom).not.toHaveBeenCalled(); expect(mockSelection).not.toHaveBeenCalled();
  expect(mockRedirect).not.toHaveBeenCalled(); expect(mockNotFound).not.toHaveBeenCalled();
});
test.each(['facility_members', 'profiles'])('AdminShell %s returned error, data+error and throw deny business children', async table => {
  const failed = table === 'profiles' ? profile : members;
  failed.error = { code: '08006' };
  expect(renderToStaticMarkup(await shell())).toContain('利用権限を再確認');
  failed.data = null;
  expect(renderToStaticMarkup(await shell())).not.toContain('synthetic protected business child');
  failed.error = null; mockDbThrow = table;
  expect(renderToStaticMarkup(await shell())).toContain('利用権限を再確認');
  expect(mockRedirect).not.toHaveBeenCalled();
});
test.each(['shell', 'registrations'] as const)('%s client initialization failure is recoverable', async target => {
  mockClient.mockRejectedValue(new Error('synthetic initialization failure'));
  expect(renderToStaticMarkup(await targets[target]())).toContain('利用権限を再確認');
  expect(mockFrom).not.toHaveBeenCalled();
});
test('true anonymous remains rejected, not treated as a verified owner', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(shell()).rejects.toThrow('synthetic redirect');
  expect(mockRedirect).toHaveBeenCalledWith('/auth/login?redirect=/admin');
  await expect(targets.registrations()).rejects.toThrow('synthetic notFound');
  await expect(targets.bookings()).rejects.toThrow('synthetic notFound');
  expect(mockFrom).not.toHaveBeenCalled(); expect(mockSelection).not.toHaveBeenCalled();
});
test('confirmed owner renders business child, no membership is denied except existing onboarding/platform support paths', async () => {
  expect(renderToStaticMarkup(await shell())).toContain('synthetic protected business child');
  members.data = [];
  await expect(shell()).rejects.toThrow('synthetic redirect');
  expect(mockRedirect).toHaveBeenCalledWith('/mypage');
  mockPath = '/admin/onboarding';
  expect(renderToStaticMarkup(await shell())).toContain('synthetic protected business child');
  mockPath = '/admin/registrations'; profile.data = { is_platform_admin: true };
  expect(renderToStaticMarkup(await shell())).toContain('運営サポート');
  mockPath = '/admin/settings';
  await expect(shell()).rejects.toThrow('synthetic redirect');
});
test('registration review requires literal platform role; query error/throw cannot grant or report 404', async () => {
  for (const data of [null, { is_platform_admin: false }, { is_platform_admin: 'true' }]) {
    profile.data = data; await expect(targets.registrations()).rejects.toThrow('synthetic notFound');
  }
  profile.data = { is_platform_admin: true };
  expect(renderToStaticMarkup(await targets.registrations())).toContain('synthetic protected business child');
  mockNotFound.mockClear(); profile.error = {};
  expect(renderToStaticMarkup(await targets.registrations())).toContain('利用権限を再確認');
  mockDbThrow = 'profiles';
  expect(renderToStaticMarkup(await targets.registrations())).toContain('利用権限を再確認');
  expect(mockNotFound).not.toHaveBeenCalled();
});
test('booking selection dependency failure remains an explicit page error, never an empty successful list', async () => {
  mockSelection.mockRejectedValue(new Error('facility_selection_unavailable'));
  await expect(targets.bookings()).rejects.toThrow('facility_selection_unavailable');
  expect(mockFrom).not.toHaveBeenCalled(); expect(mockNotFound).not.toHaveBeenCalled();
});
test('retry action requests the current document, never a business fetch or form submission', () => {
  const reload = jest.fn();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { reload } } });
  try {
    const element = AccessVerificationUnavailable();
    const button = element.props.children.find((node: ReactElement) => node.type === 'button');
    expect(button.props.type).toBe('button'); button.props.onClick(); expect(reload).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(element)).toContain('直前の操作結果は別途確認');
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

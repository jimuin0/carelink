/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import AdminLayout from '../layout';

const auth = jest.fn();
const membership = jest.fn();
const profile = jest.fn();
let pathname = '/admin/inquiries';
jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: async () => ({
    auth: { getUser: () => auth() },
    from: (table: string) => table === 'profiles'
      ? { select: () => ({ eq: () => ({ single: () => profile() }) }) }
      : { select: () => ({ eq: () => ({ in: () => membership() }) }) },
  }),
}));
jest.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-pathname': pathname }) }));
jest.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
jest.mock('@/components/admin/AdminMobileNav', () => ({ __esModule: true, default: () => <div>facility-mobile-nav</div> }));
jest.mock('@/components/admin/AdminTopNav', () => ({ __esModule: true, default: () => <div>facility-nav</div> }));
jest.mock('@/components/admin/AdminUserMenu', () => ({ __esModule: true, default: () => <div>user-menu</div> }));
jest.mock('@/components/admin/DynamicAdminWidgets', () => ({
  RealtimeBookingListener: () => <div>booking-listener</div>, AiSupportWidget: () => <div>ai-widget</div>,
}));

async function renderShell() {
  const layout = AdminLayout({ children: <div>support-content</div> });
  const shell = layout.props.children as ReactElement<{ children: ReactNode }>;
  const renderServer = shell.type as (props: { children: ReactNode }) => Promise<ReactElement>;
  return render(await renderServer(shell.props));
}
beforeEach(() => {
  pathname = '/admin/inquiries';
  auth.mockResolvedValue({ data: { user: { id: 'operator' } } });
  membership.mockResolvedValue({ data: [] });
  profile.mockResolvedValue({ data: { is_platform_admin: true } });
});
test.each(['/admin/inquiries', '/admin/registrations'])('operator without facility has a support-only shell: %s', async path => {
  pathname = path;
  await renderShell();
  expect(screen.getByText('support-content')).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: '運営サポート' })).toBeInTheDocument();
  expect(screen.getAllByRole('link').map(link => link.getAttribute('href')))
    .toEqual(['/admin/inquiries', '/admin/registrations']);
  expect(screen.queryByText('booking-listener')).not.toBeInTheDocument();
  expect(screen.queryByText('facility-nav')).not.toBeInTheDocument();
});
test('ordinary account cannot render support without facility membership', async () => {
  profile.mockResolvedValue({ data: { is_platform_admin: false } });
  await expect(renderShell()).rejects.toThrow('redirect:/mypage');
});
test('failed profile lookup offers explicit retry, not false denial or privileged shell', async () => {
  profile.mockResolvedValue({ data: null, error: { message: 'failure' } });
  await renderShell();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '利用権限を再確認' })).toBeInTheDocument();
  expect(screen.queryByText('support-content')).not.toBeInTheDocument();
  expect(screen.queryByText('facility-nav')).not.toBeInTheDocument();
  expect(screen.queryByText('booking-listener')).not.toBeInTheDocument();
});
test.each(['/admin', '/admin/settings', '/admin/inquiries-evil'])('operator-only account cannot render facility route: %s', async path => {
  pathname = path;
  await expect(renderShell()).rejects.toThrow('redirect:/mypage');
});
test('onboarding still works without a facility', async () => {
  pathname = '/admin/onboarding';
  profile.mockResolvedValue({ data: null });
  await renderShell();
  expect(screen.getByText('support-content')).toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
});
test('facility owner retains the ordinary shell', async () => {
  membership.mockResolvedValue({ data: [{ role: 'owner', facility_id: 'facility', facility_profiles: { name: 'Test facility' } }] });
  await renderShell();
  expect(screen.getByText('facility-nav')).toBeInTheDocument();
  expect(screen.getByText('booking-listener')).toBeInTheDocument();
});
test('unauthenticated layout still redirects to login', async () => {
  auth.mockResolvedValue({ data: { user: null } });
  await expect(renderShell()).rejects.toThrow('redirect:/auth/login?redirect=/admin');
});

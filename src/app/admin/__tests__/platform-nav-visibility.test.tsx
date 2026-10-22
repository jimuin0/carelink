/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import type { ReactElement, ReactNode } from 'react';
import AdminLayout from '../layout';

// 施設オーナーのナビに「押すと 404 になる運営専用ページ」を出さないことを固定する。
// 特集（/admin/features）は layout が requirePlatformAdmin で運営以外を 404 にしているのに、
// 掲載管理グループと navItems の両方に運営フラグ無しで載っていた（全オーナーに死に導線）。

type CapturedItem = { href: string };
type CapturedGroup = { key: string; items: CapturedItem[] };
let topNavGroups: CapturedGroup[] = [];
let mobileItems: CapturedItem[] = [];
let mobileGroups: CapturedGroup[] = [];

const auth = jest.fn();
const membership = jest.fn();
const profile = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: async () => ({
    auth: { getUser: () => auth() },
    from: (table: string) => table === 'profiles'
      ? { select: () => ({ eq: () => ({ single: () => profile() }) }) }
      : { select: () => ({ eq: () => ({ in: () => membership() }) }) },
  }),
}));
jest.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-pathname': '/admin' }) }));
jest.mock('next/navigation', () => ({ useSearchParams: () => null, redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
jest.mock('@/components/admin/AdminTopNav', () => ({
  __esModule: true,
  default: ({ groups }: { groups: CapturedGroup[] }) => { topNavGroups = groups; return <div>top-nav</div>; },
}));
jest.mock('@/components/admin/AdminMobileNav', () => ({
  __esModule: true,
  default: ({ items, groups }: { items: CapturedItem[]; groups: CapturedGroup[] }) => {
    mobileItems = items; mobileGroups = groups; return <div>mobile-nav</div>;
  },
}));
jest.mock('@/components/admin/AdminUserMenu', () => ({ __esModule: true, default: () => <div>user-menu</div> }));
jest.mock('@/components/admin/AdminFacilityLink', () => ({ __esModule: true, default: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
jest.mock('@/components/admin/AdminSelectedFacilityName', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/admin/AdminSelectedFacilityNotifications', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/admin/DynamicAdminWidgets', () => ({ AiSupportWidget: () => null }));

async function renderShellAs(isPlatformAdmin: boolean) {
  auth.mockResolvedValue({ data: { user: { id: 'owner' } } });
  membership.mockResolvedValue({ data: [{ role: 'owner', facility_id: 'facility', facility_profiles: { name: 'Test facility' } }] });
  profile.mockResolvedValue({ data: { is_platform_admin: isPlatformAdmin } });
  const layout = AdminLayout({ children: <div>content</div> });
  const shell = layout.props.children as ReactElement<{ children: ReactNode }>;
  const renderServer = shell.type as (props: { children: ReactNode }) => Promise<ReactElement>;
  render(await renderServer(shell.props));
}

function visibleHrefs(): string[] {
  return [
    ...topNavGroups.flatMap(g => g.items.map(i => i.href)),
    ...mobileItems.map(i => i.href),
    ...mobileGroups.flatMap(g => g.items.map(i => i.href)),
  ];
}

/** layout.tsx が requirePlatformAdmin で運営以外を弾く /admin 配下のページ（＝オーナーには 404）。 */
function platformOnlyAdminHrefs(): string[] {
  const adminDir = path.join(process.cwd(), 'src/app/admin');
  return fs.readdirSync(adminDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => {
      const layoutPath = path.join(adminDir, entry.name, 'layout.tsx');
      return fs.existsSync(layoutPath) && fs.readFileSync(layoutPath, 'utf8').includes('requirePlatformAdmin');
    })
    .map(entry => `/admin/${entry.name}`);
}

beforeEach(() => {
  topNavGroups = []; mobileItems = []; mobileGroups = [];
});

test('the platform-only page list is not empty (guards against a vacuous pass)', () => {
  expect(platformOnlyAdminHrefs()).toEqual(expect.arrayContaining(['/admin/features', '/admin/feature-flags', '/admin/moderation']));
});

test('a facility owner does not see 特集 anywhere in the admin menu', async () => {
  await renderShellAs(false);
  expect(topNavGroups.length).toBeGreaterThan(0);
  expect(mobileItems.length).toBeGreaterThan(0);
  expect(visibleHrefs()).not.toContain('/admin/features');
  // オーナーに見せている掲載管理グループ自体は残っている（グループごと消していない）
  expect(topNavGroups.find(g => g.key === 'listing')?.items.map(i => i.href)).toContain('/admin/menus');
});

test('a facility owner sees no menu entry for any page that 404s for non-platform-admins', async () => {
  await renderShellAs(false);
  const visible = visibleHrefs();
  const leaked = platformOnlyAdminHrefs().filter(href => visible.includes(href));
  expect(leaked).toEqual([]);
});

test('a platform admin still reaches 特集 from the 運営 group and the mobile menu', async () => {
  await renderShellAs(true);
  expect(topNavGroups.find(g => g.key === 'platform')?.items.map(i => i.href)).toContain('/admin/features');
  expect(mobileItems.map(i => i.href)).toContain('/admin/features');
  // 掲載管理（オーナー向け）には重複して載せない
  expect(topNavGroups.find(g => g.key === 'listing')?.items.map(i => i.href)).not.toContain('/admin/features');
});

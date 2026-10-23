/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import AdminLayout, { navItems } from '../layout';
import PackagesLayout from '../packages/layout';
import SubscriptionPlansLayout from '../subscription-plans/layout';
import JobsLayout from '../jobs/layout';
import AiSupportWidget from '@/components/admin/AiSupportWidget';

// 回数券・月額プラン・求人は「今はなし」（2026年10月23日 神原さん判断・src/lib/feature-toggles.ts）。
// 以前は管理画面のナビに出ており、作っても販売・付与・消化の手段が無い（求人は公開側が非表示で
// 誰にも見られない・応募一覧は存在しない「紹介手数料」を約束していた）。データ・API は温存し、
// ナビと画面だけを止めていることを固定する。

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

const UNOFFERED = ['/admin/packages', '/admin/subscription-plans', '/admin/jobs', '/admin/jobs/applications'];

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

beforeEach(() => {
  topNavGroups = []; mobileItems = []; mobileGroups = [];
});

test('ナビ定義そのものは温存している（トグルを戻せば復活する）', () => {
  expect(navItems.map(i => i.href)).toEqual(expect.arrayContaining(UNOFFERED));
});

test.each([false, true])('提供していない機能はナビ（上部タブ・モバイル）に出さない（運営者=%p）', async (isPlatformAdmin) => {
  await renderShellAs(isPlatformAdmin);
  const visible = visibleHrefs();
  // 空振り防止: ナビ自体は描画されている
  expect(visible).toEqual(expect.arrayContaining(['/admin/menus', '/admin/coupons']));
  expect(visible.filter(href => UNOFFERED.includes(href))).toEqual([]);
  // 掲載管理グループ自体は残す
  expect(topNavGroups.find(g => g.key === 'listing')?.items.map(i => i.href)).toContain('/admin/menus');
});

test.each([
  ['回数券', PackagesLayout],
  ['月額プラン', SubscriptionPlansLayout],
  ['求人', JobsLayout],
] as const)('%s の管理画面へ直接来たら、編集画面の代わりに「提供していません」を出す', (title, Layout) => {
  render(<Layout><div>editor</div></Layout>);
  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  expect(screen.getByText('現在この機能は提供していません。')).toBeInTheDocument();
  expect(screen.queryByText('editor')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '管理画面のホームへ戻る' })).toHaveAttribute('href', '/admin');
});

test('AI サポートの質問例に「回数券を設定したい」を出さない', () => {
  render(<AiSupportWidget />);
  fireEvent.click(screen.getByLabelText('AIサポート'));
  // 空振り防止: 質問例そのものは出ている
  expect(screen.getByText('メニューを追加するには？')).toBeInTheDocument();
  expect(screen.queryByText('回数券を設定したい')).not.toBeInTheDocument();
});

import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import AdminMobileNav from '@/components/admin/AdminMobileNav';
import dynamic from 'next/dynamic';

const RealtimeBookingListener = dynamic(() => import('@/components/admin/RealtimeBookingListener'), { ssr: false });

export const metadata: Metadata = {
  title: { default: '管理画面', template: '%s | 管理画面 | CareLink' },
  robots: { index: false, follow: false },
};

const navItems = [
  { href: '/admin', label: 'ホーム', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { href: '/admin/bookings', label: '予約', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { href: '/admin/customers', label: '顧客', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { href: '/admin/menus', label: 'メニュー', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
  { href: '/admin/staff', label: 'スタッフ', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
  { href: '/admin/reviews', label: '口コミ', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
  { href: '/admin/photos', label: '写真', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { href: '/admin/coupons', label: 'クーポン', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
  { href: '/admin/blog', label: 'ブログ', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
  { href: '/admin/catalog', label: 'カタログ', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  { href: '/admin/qa', label: 'Q&A', icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { href: '/admin/features', label: '特集', icon: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' },
  { href: '/admin/chat', label: 'チャット', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { href: '/admin/inquiries', label: '問い合わせ', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { href: '/admin/registrations', label: '施設登録', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { href: '/admin/analytics', label: '分析', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { href: '/admin/settings', label: '設定', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { href: '/admin/help', label: 'ヘルプ', icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
];

export { navItems };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login?redirect=/admin');
  }

  // マルチ施設対応: ユーザーが所属する全施設を取得
  const { data: memberships } = await supabase
    .from('facility_members')
    .select('role, facility_id, facility_profiles(name)')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']);

  if (!memberships || memberships.length === 0) {
    redirect('/mypage');
  }

  // 現在の施設（クエリパラメータ or 最初の施設）
  const membership = memberships[0];

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Mobile header */}
      <div className="lg:hidden bg-white border-b px-4 py-3 flex items-center justify-between">
        <Link href="/admin" className="text-lg font-bold text-primary">管理画面</Link>
        <Link href="/search" className="text-sm text-gray-500">サイトへ</Link>
      </div>

      <div className="flex">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:block w-60 bg-white border-r min-h-screen sticky top-0 overflow-y-auto">
          <div className="p-4 border-b">
            <Link href="/admin" className="text-lg font-bold text-primary">CareLink 管理</Link>
            {memberships.length > 1 && (
              <div className="mt-2">
                <select
                  defaultValue={membership.facility_id}
                  onChange={(e) => { window.location.href = `/admin?facility=${e.target.value}`; }}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600"
                >
                  {memberships.map((m) => (
                    <option key={m.facility_id} value={m.facility_id}>
                      {(m.facility_profiles as unknown as { name: string } | null)?.name || m.facility_id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <nav className="p-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 rounded-lg hover:bg-sky-50 hover:text-primary transition-colors"
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                </svg>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="p-4 border-t mt-2">
            <Link href="/search" className="text-sm text-gray-400 hover:text-primary">
              サイトに戻る
            </Link>
          </div>
        </aside>

        {/* Mobile bottom nav */}
        <AdminMobileNav items={navItems} />

        {/* Main */}
        <main className="flex-1 p-4 lg:p-8 pb-20 lg:pb-8">
          {children}
        </main>

        {/* リアルタイム予約通知 */}
        <RealtimeBookingListener facilityId={membership.facility_id} />
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/mypage', label: 'ダッシュボード' },
  { href: '/mypage/favorites', label: 'お気に入り' },
  { href: '/mypage/bookings', label: '予約履歴' },
  { href: '/mypage/points', label: 'ポイント' },
  { href: '/mypage/coupons', label: 'クーポン' },
  { href: '/mypage/packages', label: '回数券' },
  { href: '/mypage/subscriptions', label: '月額プラン' },
  { href: '/mypage/referral', label: '友達招待' },
  { href: '/mypage/staff', label: '指名スタッフ' },
  { href: '/mypage/reviews', label: '投稿した口コミ' },
  { href: '/mypage/profile', label: 'プロフィール' },
  { href: '/mypage/settings', label: '連携設定' },
];

// 押した実感が無い（クリックフィードバック無し）・今どのタブにいるか分からない、という
// 神原さんの指摘(2026年7月6日)に対応。active:での押下フィードバックと、現在地タブの
// ハイライト(aria-current)を追加した。usePathname が必要なためクライアントコンポーネント化。
export default function MyPageNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-2 mb-8 overflow-x-auto pb-2">
      {NAV_ITEMS.map((item) => {
        const isActive = item.href === '/mypage' ? pathname === '/mypage' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={
              isActive
                ? 'text-sm px-4 py-2 rounded-full bg-primary text-white whitespace-nowrap transition-colors active:scale-95'
                : 'text-sm px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:text-primary active:bg-sky-100 active:scale-95 transition-colors whitespace-nowrap'
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

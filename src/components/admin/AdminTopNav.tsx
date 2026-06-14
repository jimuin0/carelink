'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * SB 上部タブナビゲーション（HPB サロンボード型・CareLink 色）
 *
 * 構成（ベンチマーク: サロンボードの予約管理/掲載管理/お客様管理…の2段ナビ）:
 *  - 1段目: 主要タブ（グループ）。アクティブタブは白抜き・他は primary 上の半透明白文字。
 *  - 2段目: アクティブグループ内のサブメニュー（横並びピル）。
 * 全ての既存管理ページはいずれかのグループに属し、到達可能性を維持する。
 */

export interface NavGroup {
  key: string;
  label: string;
  items: { href: string; label: string; platformAdmin?: boolean }[];
  platformAdmin?: boolean;
}

/** pathname がグループ内のどれかに前方一致するか（最長一致でアクティブ判定） */
function matchScore(pathname: string, href: string): number {
  if (pathname === href) return href.length + 1000; // 完全一致を最優先
  if (href !== '/admin' && pathname.startsWith(href + '/')) return href.length;
  return -1;
}

export default function AdminTopNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname() ?? '/admin';

  // アクティブグループ＝配下リンクとの最長一致を持つグループ（/admin はホーム扱い）
  let activeKey = groups[0]?.key;
  let best = -1;
  for (const g of groups) {
    for (const item of g.items) {
      const s = matchScore(pathname, item.href);
      if (s > best) {
        best = s;
        activeKey = g.key;
      }
    }
  }
  const activeGroup = groups.find((g) => g.key === activeKey) ?? groups[0];

  // sticky なナビの実高さを CSS 変数 --admin-topnav-h に公開する。
  // 配下ページの sticky 要素（例: schedule のガント時間軸ヘッダ）が top をこの値に揃えることで、
  // 同じ top-0 で z-index 衝突して隠れる問題を防ぐ。レスポンシブな高さ変化に追従。
  const navRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty('--admin-topnav-h', `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--admin-topnav-h');
    };
  }, []);

  return (
    <div ref={navRef} className="hidden lg:block sticky top-0 z-40 shadow">
      {/* 1段目: 主要タブ（primary グラデーション帯） */}
      <div className="bg-gradient-to-b from-sky-600 to-sky-700">
        <div className="flex items-stretch px-2">
          {groups.map((g) => {
            const active = g.key === activeGroup?.key;
            return (
              <Link
                key={g.key}
                href={g.items[0]?.href ?? '/admin'}
                className={`px-4 py-2.5 text-[13px] font-bold border-b-[3px] transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white/95 text-sky-700 border-amber-400 rounded-t-md'
                    : 'text-white/90 border-transparent hover:bg-white/10'
                }`}
              >
                {g.label}
              </Link>
            );
          })}
        </div>
      </div>
      {/* 2段目: サブメニュー（アクティブグループの項目） */}
      <div className="bg-sky-50 border-b border-sky-100">
        <div className="flex items-center gap-1 px-3 py-1.5 overflow-x-auto">
          {activeGroup?.items.map((item) => {
            const active = matchScore(pathname, item.href) >= 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1 text-xs font-semibold rounded-full whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-sky-800 hover:bg-sky-100'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

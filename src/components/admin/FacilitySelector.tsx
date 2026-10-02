'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type MouseEvent } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { AdminFacilityChoice } from '@/lib/admin-facility-selection';
export { loadAdminFacilitySelection } from '@/lib/admin-facility-selection';
export type { AdminFacilityChoice } from '@/lib/admin-facility-selection';

export default function FacilitySelector({ choices, selectedId, path, date, dirty = false, busy = false }: {
  choices: AdminFacilityChoice[]; selectedId: string | null;
  path: '/admin/settings' | '/admin/photos' | '/admin/schedule' | '/admin/bookings';
  date?: string; dirty?: boolean; busy?: boolean;
}) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const guardNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (busy) event.preventDefault();
    else if (dirty) {
      event.preventDefault();
      setPendingHref(event.currentTarget.getAttribute('href'));
    }
  };
  if (choices.length === 0) return <p role="status">管理できる店舗がありません。</p>;
  return <section aria-label="編集する店舗" className="rounded-xl bg-white border p-4 mb-4">
    <p className="font-bold mb-2">{selectedId ? '編集する店舗' : '編集する店舗を選択してください'}</p>
    <ul className="flex flex-wrap gap-3">
      {choices.map(choice => <li key={choice.id}>
        <Link href={`${path}?facility_id=${choice.id}${date ? `&date=${encodeURIComponent(date)}` : ''}`} prefetch={false} onClick={guardNavigation} aria-disabled={busy}
          aria-current={choice.id === selectedId ? 'page' : undefined} className="text-primary underline">
          {choice.name}{choice.id === selectedId ? '（選択中）' : ''}
        </Link>
      </li>)}
    </ul>
    {selectedId && (path === '/admin/settings' || path === '/admin/photos') && <p className="mt-2 text-sm"><Link href={`${path === '/admin/settings' ? '/admin/photos' : '/admin/settings'}?facility_id=${selectedId}`}
      prefetch={false} onClick={guardNavigation} aria-disabled={busy} className="text-primary underline">{path === '/admin/settings' ? 'この店舗の写真を管理' : 'この店舗の基本情報を編集'}</Link></p>}
    <ConfirmDialog open={pendingHref !== null} title="未保存の変更があります"
      message="未保存の変更を破棄して移動しますか？" confirmLabel="破棄して移動" confirmDisabled={busy}
      onCancel={() => setPendingHref(null)} onConfirm={() => {
        if (busy || pendingHref === null) return;
        router.push(pendingHref);
        setPendingHref(null);
      }} />
  </section>;
}

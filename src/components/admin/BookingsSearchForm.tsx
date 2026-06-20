'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { bookingsHref } from '@/lib/admin-bookings-url';
import { bookingStatusLabel } from '@/lib/booking-status';
import { SbInput } from '@/components/admin/SbUi';

const STATUS_OPTIONS = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled'] as const;

export interface BookingsSearchInitial {
  from: string;
  to: string;
  statuses: string[];
  q: string;
  staff: string;
}

export default function BookingsSearchForm({
  initial,
  staffList,
}: {
  initial: BookingsSearchInitial;
  staffList: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [statuses, setStatuses] = useState<string[]>(initial.statuses);
  const [q, setQ] = useState(initial.q);
  const [staff, setStaff] = useState(initial.staff);

  const toggleStatus = (s: string) =>
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const submit = () => {
    router.push(
      bookingsHref({
        from: from || null,
        to: to || null,
        statuses,
        q: q.trim() || null,
        staff: staff || null,
      })
    );
  };

  const clear = () => {
    setFrom('');
    setTo('');
    setStatuses([]);
    setQ('');
    setStaff('');
    router.push('/admin/bookings');
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-4">
      {/* 来店日（範囲） */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">来店日</label>
        <div className="flex items-center gap-2">
          <SbInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-auto" aria-label="来店日（開始）" />
          <span className="text-gray-400 text-sm">〜</span>
          <SbInput type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-auto" aria-label="来店日（終了）" />
        </div>
      </div>

      {/* ステータス（複数選択） */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">ステータス</label>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {STATUS_OPTIONS.map((s) => (
            <label key={s} className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={statuses.includes(s)} onChange={() => toggleStatus(s)} className="rounded border-gray-300" />
              <span>{bookingStatusLabel(s)}</span>
            </label>
          ))}
        </div>
      </div>

      {/* お客様名・スタッフ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="bk-q" className="block text-xs font-medium text-gray-600 mb-1.5">お客様名</label>
          <SbInput id="bk-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        </div>
        <div>
          <label htmlFor="bk-staff" className="block text-xs font-medium text-gray-600 mb-1.5">スタッフ</label>
          <select id="bk-staff" value={staff} onChange={(e) => setStaff(e.target.value)} className="form-input">
            <option value="">すべてのスタッフ</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={clear} className="text-sm text-gray-500 hover:underline">条件をクリア</button>
        <button type="button" onClick={submit} className="btn-primary ml-auto !py-2.5 !px-8">検索する</button>
      </div>
    </div>
  );
}

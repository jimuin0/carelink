'use client';

import { useState } from 'react';

/** Draft only: the parent must persist and validate this per facility. */
export interface SpecialHoursDraft {
  allowOvernightBookings: boolean;
  closeOnPublicHolidays: boolean;
  closedDates: string[];
  receptionCutoffMinutes: number | null;
}

interface Props {
  value: SpecialHoursDraft;
  onChange: (value: SpecialHoursDraft) => void;
}

export default function SpecialHoursEditor({ value, onChange }: Props) {
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const addDate = () => {
    if (!date) { setError('日付を選択してください'); return; }
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      setError('正しい日付を選択してください'); return;
    }
    if (value.closedDates.includes(date)) { setError('この日付は追加済みです'); return; }
    onChange({ ...value, closedDates: [...value.closedDates, date].sort() });
    setDate(''); setError('');
  };
  return <div className="space-y-5">
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value.allowOvernightBookings} onChange={event => onChange({ ...value, allowOvernightBookings: event.target.checked })} />
      日付をまたぐ予約を受け付ける
    </label>
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value.closeOnPublicHolidays} onChange={event => onChange({ ...value, closeOnPublicHolidays: event.target.checked })} />
      祝日・振替休日を休業にする
    </label>
    <div>
      <label htmlFor="special-closed-date" className="block text-sm font-bold">臨時休業日</label>
      <p className="mt-1 text-sm text-gray-600">選んだ日付は0時から24時まで休業します。</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input id="special-closed-date" type="date" value={date} onChange={event => { setDate(event.target.value); setError(''); }} className="rounded border border-gray-300 p-2" />
        <button type="button" onClick={addDate} className="min-h-11 px-3 text-sm text-sky-700 underline">休業日を追加</button>
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
      <ul className="mt-2 space-y-2">{value.closedDates.map(day => <li key={day} className="flex items-center gap-2 text-sm">
        <time dateTime={day}>{day.replaceAll('-', '/')}</time>
        <button type="button" aria-label={`${day}の臨時休業を削除`} onClick={() => onChange({ ...value, closedDates: value.closedDates.filter(existing => existing !== day) })} className="min-h-11 px-2 text-rose-700 underline">削除</button>
      </li>)}</ul>
    </div>
    <div>
      <label htmlFor="reception-cutoff" className="block text-sm font-bold">受付終了時刻</label>
      <p className="mt-1 text-sm text-gray-600">各営業時間の終了何分前に受付を終えるかを設定します。</p>
      <select id="reception-cutoff" value={value.receptionCutoffMinutes === null ? '' : String(value.receptionCutoffMinutes)} onChange={event => onChange({ ...value, receptionCutoffMinutes: event.target.value === '' ? null : Number(event.target.value) })} className="mt-2 rounded border border-gray-300 p-2">
        <option value="">設定しない</option>
        {[0, 5, 10, 15, 20, 30, 45, 60, 90, 120].map(minutes => <option key={minutes} value={minutes}>{minutes === 0 ? '終了時刻まで' : `${minutes}分前`}</option>)}
      </select>
    </div>
  </div>;
}

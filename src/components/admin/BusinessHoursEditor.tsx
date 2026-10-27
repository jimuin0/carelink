'use client';

import { dayLabels, dayOrder } from '@/lib/constants';
import { MAX_BUSINESS_PERIODS, type BusinessPeriod } from '@/lib/business-hours';
import type { HoursDraft, HoursWindow } from '@/lib/business-hours-form';
import { SbInput } from './SbUi';
import { useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';

interface Props {
  hours: HoursDraft;
  closedDays: readonly string[];
  onDayChange: (day: string, value: HoursWindow) => void;
  onToggleClosed: (day: string) => void;
}

export default function BusinessHoursEditor({ hours, closedDays, onDayChange, onToggleClosed }: Props) {
  const [pendingDay, setPendingDay] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ day: string; index: number } | null>(null);
  const setPeriods = (day: string, periods: BusinessPeriod[]) => {
    onDayChange(day, periods.length === 1 ? periods[0] : { ...periods[0], periods });
  };
  return <div className="space-y-4">
    <p className="text-sm leading-6 text-gray-600">開始は00:00〜23:59、終了は00:00〜24:00で設定できます。終了が開始より早ければ翌日までの営業です。中休みは時間帯を分けて追加してください。</p>
    {dayOrder.map(day => {
      const closed = closedDays.includes(day);
      const entry = hours[day] ?? { open: '', close: '' };
      const periods = entry.periods ?? [{ open: entry.open, close: entry.close }];
      const update = (index: number, field: 'open' | 'close', value: string) => {
        if (periods[index][field] === value) return;
        setPeriods(day, periods.map((period, at) => at === index ? { ...period, [field]: value } : period));
      };
      return <fieldset key={day} className="rounded-lg border border-gray-200 p-3 sm:p-4">
        <legend className="px-1 text-sm font-bold">{dayLabels[day]}曜日</legend>
        <label className="mb-3 inline-flex items-center gap-2 text-sm">
          <input type="checkbox" aria-label={`${dayLabels[day]}曜日に営業する`} checked={!closed} onChange={() => onToggleClosed(day)} />
          この曜日に営業を開始する
        </label>
        {closed ? <p className="text-sm text-gray-500">休み（前日からの営業は継続します）</p> : <>
          <div className="space-y-3">{periods.map((period, index) => {
            const label = `${dayLabels[day]}曜日の${index === 0 ? '' : `${index + 1}枠目の`}`;
            return <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <span className="col-span-3 text-xs text-gray-500">時間帯{index + 1}</span>
              <SbInput type="time" aria-label={`${label}開店時間`} value={period.open} onChange={event => update(index, 'open', event.target.value)} onInput={event => update(index, 'open', event.currentTarget.value)} onBlur={event => update(index, 'open', event.target.value)} className="min-w-0 w-full! py-2! px-2! text-sm" />
              <span aria-hidden="true">〜</span>
              <SbInput type="text" placeholder="18:00" maxLength={5} aria-label={`${label}閉店時間`} value={period.close} onChange={event => update(index, 'close', event.target.value)} onInput={event => update(index, 'close', event.currentTarget.value)} onBlur={event => update(index, 'close', event.target.value)} className="min-w-0 w-full! py-2! px-2! text-sm" />
              {period.close && period.open && period.close < period.open && <span className="col-start-3 text-xs text-gray-600">翌日</span>}
              {periods.length > 1 && <button type="button" aria-label={`${dayLabels[day]}曜日の時間帯${index + 1}を削除`} onClick={() => {
                if (period.open || period.close) setPendingRemoval({ day, index });
                else setPeriods(day, periods.filter((_, at) => at !== index));
              }} className="col-span-3 min-h-11 justify-self-end px-2 text-sm text-rose-700">削除</button>}
            </div>;
          })}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <button type="button" disabled={periods.length >= MAX_BUSINESS_PERIODS} onClick={() => setPeriods(day, [...periods, { open: '', close: '' }])} className="min-h-11 text-sky-700 underline disabled:text-gray-400">時間帯を追加</button>
            <button type="button" onClick={() => {
              if (periods.some(period => period.open || period.close)) setPendingDay(day);
              else setPeriods(day, [{ open: '00:00', close: '24:00' }]);
            }} className="min-h-11 text-sky-700 underline">24時間営業にする</button>
          </div>
        </>}
      </fieldset>;
    })}
    <ConfirmDialog open={pendingDay !== null} title="営業時間を置き換えますか？" message={`${pendingDay ? dayLabels[pendingDay] : ''}曜日の入力済みの時間帯を24時間営業に置き換えます。保存するまで公開内容は変わりません。`} confirmLabel="置き換える" onCancel={() => setPendingDay(null)} onConfirm={() => { if (pendingDay) setPeriods(pendingDay, [{ open: '00:00', close: '24:00' }]); setPendingDay(null); }} />
    <ConfirmDialog open={pendingRemoval !== null} title="時間帯を削除しますか？" message="入力済みの時間帯を削除します。保存するまで公開内容は変わりません。" confirmLabel="削除する" onCancel={() => setPendingRemoval(null)} onConfirm={() => {
      if (pendingRemoval) {
        const entry = hours[pendingRemoval.day];
        const periods = entry?.periods ?? (entry ? [{ open: entry.open, close: entry.close }] : []);
        if (periods.length > 1) setPeriods(pendingRemoval.day, periods.filter((_, index) => index !== pendingRemoval.index));
      }
      setPendingRemoval(null);
    }} />
  </div>;
}

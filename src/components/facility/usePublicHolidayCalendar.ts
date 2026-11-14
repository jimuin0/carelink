'use client';

import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import type { HolidayCalendar } from '@/lib/special-business-hours';

const schema = z.object({ from: z.iso.date(), through: z.iso.date(), dates: z.array(z.iso.date()).max(1000) });
let calendar: HolidayCalendar | null = null;
let attempted = false;
let fetchedAt = 0;
let pending = false;
const listeners = new Set<() => void>();
function requestCalendar() {
  if (pending) return;
  attempted = true;
  pending = true;
  void fetch('/api/public/holidays').then(async response => {
    if (!response.ok) return;
    const parsed = schema.safeParse(await response.json());
    if (parsed.success && parsed.data.from <= parsed.data.through) {
      calendar = { from: parsed.data.from, through: parsed.data.through, dates: new Set(parsed.data.dates) };
      fetchedAt = Date.now();
      listeners.forEach(notify => notify());
    }
  }).catch(() => {}).finally(() => { pending = false; });
}
function refreshOnFocus() {
  if (!calendar || Date.now() - fetchedAt >= 30 * 60 * 1000) {
    if (calendar) { calendar = null; listeners.forEach(notify => notify()); }
    requestCalendar();
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('focus', refreshOnFocus);
  if (!attempted) requestCalendar();
  return () => { listeners.delete(listener); if (listeners.size === 0) window.removeEventListener('focus', refreshOnFocus); };
}
const noop = () => () => {};
export function usePublicHolidayCalendar(enabled: boolean): HolidayCalendar | null {
  return useSyncExternalStore(enabled ? subscribe : noop, () => enabled ? calendar : null, () => null);
}

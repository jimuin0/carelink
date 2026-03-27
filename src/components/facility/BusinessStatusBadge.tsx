'use client';

import { useMemo } from 'react';

interface Props {
  businessHours: Record<string, { open: string; close: string } | null> | null;
  regularHoliday?: string | null;
}

export default function BusinessStatusBadge({ businessHours }: Props) {
  const status = useMemo(() => {
    if (!businessHours) return 'unknown';
    const now = new Date();
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const today = days[now.getDay()];
    const todayHours = businessHours[today];

    if (!todayHours) return 'holiday';

    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    return currentTime >= todayHours.open && currentTime < todayHours.close ? 'open' : 'closed';
  }, [businessHours]);

  if (status === 'unknown') return null;

  const config = {
    open: { text: '営業中', className: 'bg-emerald-100 text-emerald-700' },
    closed: { text: '営業時間外', className: 'bg-gray-100 text-gray-500' },
    holiday: { text: '定休日', className: 'bg-red-50 text-red-500' },
  };

  const { text, className } = config[status];

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'open' ? 'bg-emerald-500' : status === 'holiday' ? 'bg-red-400' : 'bg-gray-400'}`} />
      {text}
    </span>
  );
}

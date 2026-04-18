'use client';

import { useState, useEffect } from 'react';

export default function RemainingSlots({ facilityId }: { facilityId: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const today = `${year}-${String(month).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    fetch(`/api/availability?facilityId=${facilityId}&year=${year}&month=${month}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => {
        const todayData = data?.dates?.[today];
        if (todayData?.slots != null) {
          setRemaining(todayData.slots);
        }
      })
      .catch(() => {});
  }, [facilityId]);

  if (remaining === null || remaining > 5) return null;

  return (
    <span className="text-xs text-red-500 font-bold animate-pulse">
      {remaining === 0 ? '本日満枠' : `本日残り${remaining}枠`}
    </span>
  );
}

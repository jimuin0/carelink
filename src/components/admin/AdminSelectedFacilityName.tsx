'use client';
import { useSearchParams } from 'next/navigation';
import type { AdminFacilityChoice } from '@/lib/admin-facility-selection';

export default function AdminSelectedFacilityName({ choices }: { choices: AdminFacilityChoice[] }) {
  const requested = useSearchParams()?.get('facility_id') ?? null;
  const selected = requested === null ? (choices.length === 1 ? choices[0] : null) : choices.find(choice => choice.id === requested);
  return <span aria-label="選択店舗" className="text-sm font-bold text-gray-700 border-l border-gray-200 pl-4 truncate max-w-[240px]">
    {selected?.name ?? '店舗未選択'}
  </span>;
}

'use client';
import { useSearchParams } from 'next/navigation';
import type { AdminFacilityChoice } from '@/lib/admin-facility-selection';
import { RealtimeBookingListener } from '@/components/admin/DynamicAdminWidgets';

export default function AdminSelectedFacilityNotifications({ choices }: { choices: AdminFacilityChoice[] }) {
  const requested = useSearchParams()?.get('facility_id') ?? null;
  const selected = requested === null ? (choices.length === 1 ? choices[0] : null) : choices.find(choice => choice.id === requested);
  return selected ? <RealtimeBookingListener key={selected.id} facilityId={selected.id} /> : null;
}

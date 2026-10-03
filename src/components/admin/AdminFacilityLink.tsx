'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ComponentProps } from 'react';
import { adminFacilityHref } from '@/lib/admin-facility-url';

export default function AdminFacilityLink({ href, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const facilityId = useSearchParams()?.get('facility_id') ?? null;
  return <Link {...props} href={adminFacilityHref(href, facilityId)} />;
}

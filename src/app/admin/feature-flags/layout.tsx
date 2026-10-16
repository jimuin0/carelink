import { requirePlatformAdmin } from '@/lib/platform-admin';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function FeatureFlagsLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  if (user instanceof NextResponse) return <AccessVerificationUnavailable />;
  if (!user) notFound();
  return <>{children}</>;
}
